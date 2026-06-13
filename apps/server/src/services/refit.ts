import { expandGrid, scoreMetrics, type Objective, type OptimizeSpace } from '@tpx/core'
import type { BacktestConfig, BacktestMetrics, ParamValues } from '@tpx/shared'
import { DEFAULT_FEES } from '@tpx/shared'
import type { Db } from '@tpx/db'
import { env } from '../env'
import { hub } from '../wsHub'
import { registry } from '../strategies'
import { sendTelegram } from './telegram'
import type { SettingsService } from './settings'
import type { BotManager } from './botManager'
import type { WorkerOutMsg, WorkerRunMsg } from '../workers/backtestWorker'

/**
 * Refit périodique : ré-estime les paramètres d'un bot DANS une grille bornée
 * (le plateau validé en walk-forward), avec un score mécanique. La structure
 * de la stratégie ne change jamais — seul le point dans le plateau bouge.
 */
export interface RefitConfig {
  enabled: boolean
  /** 'auto' applique quand le bot est flat ; 'propose' attend ta validation */
  mode: 'auto' | 'propose'
  /** cadence en jours (la validation walk-forward couvre ~90-280 j) */
  everyDays: number
  /** fenêtre d'estimation en jours (≈ 600 = 20 mois) */
  windowDays: number
  /** grille bornée — restez dans le plateau validé */
  space: OptimizeSpace
  objective: Objective
  /** combos avec moins de trades = disqualifiées */
  minTrades: number
  /** amélioration minimale du score vs paramètres courants pour changer (ex 1.05 = +5 %) */
  minImprovement: number
}

export interface RefitState {
  config: RefitConfig
  lastRunAt: number | null
  lastReport: string | null
  /** proposition en attente (mode propose, ou auto avec position ouverte) */
  proposal: { params: ParamValues; report: string; at: number } | null
}

export const DEFAULT_REFIT_CONFIG: RefitConfig = {
  enabled: false,
  mode: 'propose',
  everyDays: 90,
  windowDays: 600,
  space: {},
  objective: 'profitFactor',
  minTrades: 15,
  minImprovement: 1.05,
}

/** grilles par défaut par stratégie (plateaux validés en recherche) */
export const DEFAULT_SPACES: Record<string, OptimizeSpace> = {
  'er-flow-trend': {
    erMin: [0.25, 0.35, 0.45],
    emaLen: [50, 100],
    atrMult: [2, 3],
  },
  // bornée au plateau validé : htfSlopeDays >= 14 (jamais 0, qui désactive le
  // filtre déterminant et saigne). rebuyEmaLen est la valeur la plus sensible
  // (la sortie est la cause n°1 des trades perdants) → on la fait refitter.
  // 3×3×2 = 18 combinaisons.
  'btc-accumulator': {
    htfSlopeDays: [14, 30, 45],
    rebuyEmaLen: [60, 75, 100],
    emaLen: [50, 100],
  },
}

/** objectif de score par stratégie (défaut : profitFactor). */
export const DEFAULT_OBJECTIVE: Record<string, Objective> = {
  // BTC Accumulator : maximiser le BTC accumulé (net % en dénomination base)
  'btc-accumulator': 'netProfit',
}

const key = (botId: string): string => `refit:${botId}`

export class RefitService {
  private timer: ReturnType<typeof setInterval> | null = null
  private busy = false

  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly bots: BotManager,
  ) {}

  start(): void {
    // tick horaire : refits dus + propositions auto en attente de flat
    this.timer = setInterval(() => void this.tick(), 3_600_000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  async getState(botId: string): Promise<RefitState> {
    const saved = await this.settings.get<RefitState | null>(key(botId), null)
    if (saved) return saved
    // pas d'état sauvegardé → défauts adaptés à la stratégie du bot
    const bot = await this.bots.getConfig(botId).catch(() => null)
    const objective = (bot && DEFAULT_OBJECTIVE[bot.strategyId]) || DEFAULT_REFIT_CONFIG.objective
    return {
      config: { ...DEFAULT_REFIT_CONFIG, objective },
      lastRunAt: null,
      lastReport: null,
      proposal: null,
    }
  }

  async setConfig(botId: string, config: RefitConfig): Promise<RefitState> {
    const state = await this.getState(botId)
    const next: RefitState = { ...state, config }
    await this.settings.set(key(botId), next)
    return next
  }

  private async tick(): Promise<void> {
    if (this.busy) return
    const configs = await this.bots.listConfigs()
    for (const bot of configs) {
      const state = await this.getState(bot.id)
      if (!state.config.enabled) continue
      // proposition 'auto' en attente : appliquer dès que flat
      if (state.proposal && state.config.mode === 'auto') {
        await this.tryApply(bot.id).catch(() => {})
        continue
      }
      const due = state.lastRunAt === null || Date.now() - state.lastRunAt > state.config.everyDays * 86_400_000
      if (due) {
        await this.run(bot.id).catch((err: unknown) => {
          console.error(`refit ${bot.id}:`, err)
        })
      }
    }
  }

  /** exécute le refit maintenant (grille sur fenêtre glissante, score mécanique) */
  async run(botId: string): Promise<RefitState> {
    if (this.busy) throw new Error('Un refit est déjà en cours')
    this.busy = true
    try {
      const bot = await this.bots.getConfig(botId)
      if (!bot) throw new Error('Bot introuvable')
      const state = await this.getState(botId)
      const cfg = state.config
      const space = Object.keys(cfg.space).length > 0 ? cfg.space : DEFAULT_SPACES[bot.strategyId]
      if (!space) throw new Error(`Aucune grille de refit pour '${bot.strategyId}' — configurez space`)

      const entry = registry.get(bot.strategyId)
      const end = Date.now()
      const start = end - cfg.windowDays * 86_400_000
      const combos = expandGrid(entry.def.schema, bot.params, space)

      // certaines stratégies se mesurent en actif de base (ex : BTC Accumulator
      // → dénomination BTC). On reprend leurs défauts de backtest pour que le
      // refit optimise la bonne métrique (le BTC accumulé, pas l'USDT).
      const denomination = entry.def.backtest?.denomination ?? 'quote'
      const initialBalance = entry.def.backtest?.initialBalance ?? 10_000

      const mkCfg = (params: ParamValues): BacktestConfig => ({
        strategyId: bot.strategyId,
        params,
        market: bot.market,
        symbol: bot.symbol,
        start,
        end,
        initialBalance,
        denomination,
        leverage: bot.leverage,
        fees: DEFAULT_FEES[bot.market],
        slippagePct: 0.0005,
        fillMode: 'candle',
        intrabarPath: 'heuristic',
        limitFillRatio: 0.25,
        fundingEnabled: true,
        maintenanceMarginRate: 0.005,
        warmupBars: 300,
      })

      // score des paramètres COURANTS d'abord (référence à battre)
      const currentMetrics = await this.runWorker(mkCfg(bot.params), entry.path)
      const currentScore = currentMetrics.totalTrades >= cfg.minTrades ? scoreMetrics(currentMetrics, cfg.objective) : 0

      let best: { params: ParamValues; metrics: BacktestMetrics; score: number } | null = null
      for (const params of combos) {
        const metrics = await this.runWorker(mkCfg(params), entry.path)
        const score = metrics.totalTrades >= cfg.minTrades ? scoreMetrics(metrics, cfg.objective) : Number.NEGATIVE_INFINITY
        if (!best || score > best.score) best = { params, metrics, score }
      }
      if (!best) throw new Error('grille vide')

      const sweepKeys = Object.keys(space)
      const pick = sweepKeys.map((k) => `${k}=${best!.params[k]}`).join(', ')
      const cur = sweepKeys.map((k) => `${k}=${bot.params[k]}`).join(', ')
      const improved = Number.isFinite(best.score) && best.score > currentScore * cfg.minImprovement

      let report =
        `Refit ${bot.name} (${cfg.windowDays}j, ${combos.length} combos, objectif ${cfg.objective})\n` +
        `Courant  [${cur}] → score ${currentScore.toFixed(2)} (${currentMetrics.totalTrades} trades)\n` +
        `Meilleur [${pick}] → score ${best.score.toFixed(2)} (${best.metrics.totalTrades} trades, net ${best.metrics.netProfitPct.toFixed(1)}%, dd ${best.metrics.maxDrawdownPct.toFixed(1)}%)`

      let proposal: RefitState['proposal'] = null
      if (!improved) {
        report += `\n→ Pas de changement (amélioration < ×${cfg.minImprovement})`
      } else {
        proposal = { params: { ...bot.params, ...best.params }, report, at: Date.now() }
        report += cfg.mode === 'auto' ? `\n→ Application automatique (dès que flat)` : `\n→ Proposition en attente de validation`
      }

      const next: RefitState = { config: cfg, lastRunAt: Date.now(), lastReport: report, proposal }
      await this.settings.set(key(botId), next)
      sendTelegram(`🔁 <b>${bot.name}</b>\n${report}`)
      hub.publish('bots', { t: 'bot:log', botId, entry: { time: Date.now(), level: 'info', message: report } })

      if (proposal && cfg.mode === 'auto') {
        await this.tryApply(botId).catch(() => {})
      }
      return this.getState(botId)
    } finally {
      this.busy = false
    }
  }

  /** applique la proposition si le bot est flat (stop → update → restart) */
  async tryApply(botId: string): Promise<boolean> {
    const state = await this.getState(botId)
    if (!state.proposal) return false
    const runner = this.bots.runner(botId)
    if (runner) {
      const pos = runner.info().position
      if (pos !== null && pos.qty !== 0) return false // attendre flat
      await this.bots.stop(botId, { reason: 'refit' })
      await this.bots.update(botId, { params: state.proposal.params })
      await this.bots.start(botId)
    } else {
      await this.bots.update(botId, { params: state.proposal.params })
    }
    await this.settings.set(key(botId), { ...state, proposal: null })
    const bot = await this.bots.getConfig(botId)
    sendTelegram(`✅ <b>${bot?.name ?? botId}</b> — nouveaux paramètres appliqués (refit)`)
    return true
  }

  async discardProposal(botId: string): Promise<void> {
    const state = await this.getState(botId)
    await this.settings.set(key(botId), { ...state, proposal: null })
  }

  private runWorker(config: BacktestConfig, strategyPath: string): Promise<BacktestMetrics> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('../workers/backtestWorker.ts', import.meta.url))
      worker.onmessage = (ev: MessageEvent) => {
        const msg = ev.data as WorkerOutMsg
        if (msg.kind === 'done') {
          worker.terminate()
          resolve(msg.metrics as BacktestMetrics)
        } else if (msg.kind === 'error') {
          worker.terminate()
          reject(new Error(msg.message))
        }
      }
      worker.onerror = (ev) => {
        worker.terminate()
        reject(new Error(ev.message ?? 'worker crash'))
      }
      const msg: WorkerRunMsg = {
        kind: 'run',
        config,
        strategyPath,
        dataDir: env.dataDir,
        databaseUrl: env.databaseUrl,
      }
      worker.postMessage(msg)
    })
  }
}
