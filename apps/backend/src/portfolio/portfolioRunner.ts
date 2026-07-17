/**
 * PortfolioRunner — le runner quotidien (Phase A, lot A4).
 *
 * MODES : 'paper' (défaut — positions simulées au close, funding réel,
 * équité persistée) · 'dry' (plan journalisé, rien d'autre). Le mode LIVE
 * n'existe volontairement PAS en Phase A. RIEN n'est branché à index.ts :
 * le tick se lance à la main ou par cron externe, et s'abstient de lui-même
 * si les données ne sont pas fraîches.
 *
 * GARDES (héritées de l'incident 2026-07-14, adaptées au portefeuille) :
 *  - fraîcheur : dernier close > 36 h → ABSTENTION totale + alerte ;
 *  - kill switch : fichier `portfolio.KILL` à la racine → abstention ;
 *  - plafond brut : Σ|cibles| ≤ 2,2 × sleeve sinon abstention (une sleeve
 *    C3 vaut 2× en régime normal) ;
 *  - Telegram par tick : décision + plan + équité paper.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DAY } from '../research/portfolio-bt/data'
import { GATE_BPS, K as K_REGIME } from '../research/portfolio-bt/regime1'
import type { PortfolioDataFeed } from './dataFeed'
import { gateValue, regime1Targets, type DayContext, type TargetWeights } from './targets'
import { fetchSwapInstruments, planRebalance, OkxPortfolioAdapter, toOkxInstId, type RebalancePlan } from './okxPortfolioAdapter'

export interface RunnerState {
  /** ancre de la grille K7 (ms UTC minuit) — figée au premier tick */
  anchorTs: number | null
  /** dernières cibles appliquées (pour tenir les positions hors rebal) */
  lastTargets: { weights: Array<[string, number]>; btc: number; note: string } | null
  /** paper : positions par instId en notional USD signé */
  paperPositions: Array<[string, number]>
  paperEquityUsd: number
  paperHistory: Array<{ day: string; equity: number; note: string }>
  lastTickDay: string | null
}

export interface RunnerConfig {
  sleeveUsd: number
  mode: 'paper' | 'dry'
  statePath: string
  killPath: string
  telegram?: (msg: string) => void
}

const GROSS_CAP_MULT = 2.2
const MAX_STALE_MS = 36 * 3_600_000

export function loadState(path: string): RunnerState {
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) as RunnerState
  return { anchorTs: null, lastTargets: null, paperPositions: [], paperEquityUsd: 0, paperHistory: [], lastTickDay: null }
}

export function saveState(path: string, s: RunnerState): void {
  writeFileSync(path, JSON.stringify(s, null, 1))
}

export class PortfolioRunner {
  constructor(private readonly feed: PortfolioDataFeed, private readonly cfg: RunnerConfig) {}

  private say(msg: string): void {
    console.log(msg)
    this.cfg.telegram?.(msg)
  }

  /** un tick = une décision quotidienne complète (idempotent par jour) */
  async tick(fundingSource: 'csv' | 'table'): Promise<void> {
    const state = loadState(this.cfg.statePath)
    if (existsSync(this.cfg.killPath)) {
      this.say('🛑 portfolio : kill switch actif — abstention totale')
      return
    }
    const { ctx, btcR } = await this.feed.loadContext(fundingSource)
    const dayMs = ctx.spot.ts[ctx.t]
    const day = new Date(dayMs).toISOString().slice(0, 10)
    if (Date.now() - dayMs > MAX_STALE_MS && process.env.PORTFOLIO_ALLOW_STALE !== '1') {
      this.say(`⚠ portfolio : données périmées (dernier close ${day}) — abstention`)
      return
    }
    if (state.lastTickDay === day) {
      this.say(`portfolio : tick déjà fait pour ${day} — rien à faire`)
      return
    }
    if (state.anchorTs === null) state.anchorTs = dayMs
    const isRebal = Math.round((dayMs - state.anchorTs) / DAY) % K_REGIME === 0

    const prev: TargetWeights | null = state.lastTargets
      ? { weights: new Map(state.lastTargets.weights), btc: state.lastTargets.btc, note: state.lastTargets.note }
      : null
    const tg = regime1Targets(ctx, isRebal, prev)
    const g = gateValue(ctx)
    this.say(`📊 portfolio ${day} — porte ${(g * 1e4).toFixed(2)} bps/j (seuil ${GATE_BPS}) · ${isRebal ? 'REBAL' : 'tenue'} · ${tg.note}`)

    const gross = [...tg.weights.values()].reduce((s, w) => s + Math.abs(w), 0) + Math.abs(tg.btc)
    if (gross * this.cfg.sleeveUsd > GROSS_CAP_MULT * this.cfg.sleeveUsd) {
      this.say(`🛑 plafond brut dépassé (${gross.toFixed(2)}× > ${GROSS_CAP_MULT}) — abstention`)
      return
    }

    const positions = new Map(state.paperPositions)
    const instruments = await fetchSwapInstruments()
    const plan = planRebalance(tg.weights, tg.btc, this.cfg.sleeveUsd, positions, instruments)
    const adapter = new OkxPortfolioAdapter()
    await adapter.execute(plan, (m) => this.say(m))

    if (this.cfg.mode === 'paper') {
      this.applyPaper(state, ctx, btcR, plan, positions, day)
    }
    state.lastTargets = { weights: [...tg.weights.entries()], btc: tg.btc, note: tg.note }
    state.lastTickDay = day
    saveState(this.cfg.statePath, state)
  }

  /** paper : marque les positions aux closes du jour + funding, applique le plan au close */
  private applyPaper(state: RunnerState, ctx: DayContext, btcR: Float64Array, plan: RebalancePlan, positions: Map<string, number>, day: string): void {
    const { spot, perp, fund, t } = ctx
    const na = spot.na
    let pnl = 0
    const idBySym = new Map(spot.syms.map((s, a) => [toOkxInstId(s), a]))
    for (const [instId, notional] of positions) {
      if (notional === 0) continue
      const a = idBySym.get(instId)
      if (instId === 'BTC-USDT-SWAP') {
        pnl += btcR[t] * notional - fund.btcDaily[t] * notional
        continue
      }
      if (a === undefined) continue
      const r = Math.log(perp.px[t * na + a] / perp.px[(t - 1) * na + a])
      const rr = Number.isFinite(r)
        ? r
        : (Math.log(spot.px[t * na + a] / spot.px[(t - 1) * na + a]) || 0)
      pnl += (Number.isFinite(rr) ? rr : 0) * notional - fund.F[t * na + a] * notional
    }
    for (const o of plan.orders) {
      pnl -= 0.003 * o.notionalUsd                       // coût taker provisionné
      const signed = (o.side === 'buy' ? 1 : -1) * o.notionalUsd
      positions.set(o.instId, (positions.get(o.instId) ?? 0) + signed)
    }
    for (const [id, v] of positions) if (Math.abs(v) < 1) positions.delete(id)
    state.paperEquityUsd += pnl
    state.paperPositions = [...positions.entries()]
    state.paperHistory.push({ day, equity: Math.round(state.paperEquityUsd * 100) / 100, note: `${positions.size} positions` })
    this.say(`💼 paper : pnl jour ${pnl.toFixed(2)} USDT · équité cumulée ${state.paperEquityUsd.toFixed(2)} USDT · ${positions.size} positions`)
  }
}

export function defaultPaths(): { statePath: string; killPath: string } {
  const root = resolve(import.meta.dir, '../../../..')
  return {
    statePath: resolve(root, 'apps/backend/src/portfolio/.paper-state.json'),
    killPath: resolve(root, 'portfolio.KILL'),
  }
}
