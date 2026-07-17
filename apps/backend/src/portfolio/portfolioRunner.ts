/**
 * PortfolioRunner — le runner quotidien (Phase A/B).
 *
 * Porte les DEUX stratégies validées avec états et positions SÉPARÉS
 * (regime1 = sleeve régimée K7 ; listing2 = slots événementiels K30) —
 * elles peuvent shorter le même instrument, l'attribution reste propre.
 *
 * MODES : 'paper' (défaut) · 'dry'. Le mode LIVE n'existe volontairement
 * PAS avant la Phase C (GO explicite). RIEN n'est branché à index.ts, et
 * AUCUN déploiement VPS sans GO explicite de Mario (règle du 2026-07-17).
 *
 * GARDES : fraîcheur 36 h → abstention · kill switch `portfolio.KILL` ·
 * plafond brut 2,2× par sleeve · tick idempotent par jour · Telegram
 * (no-op si non configuré).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DAY } from '../research/portfolio-bt/data'
import { GATE_BPS, K as K_REGIME } from '../research/portfolio-bt/regime1'
import type { PortfolioDataFeed } from './dataFeed'
import {
  gateValue, listing2Step, regime1Targets,
  type DayContext, type Listing2State, type TargetWeights,
} from './targets'
import {
  fetchSwapInstruments, planRebalance, OkxPortfolioAdapter, toOkxInstId,
  type OkxInstrument, type RebalancePlan,
} from './okxPortfolioAdapter'

interface StratBook {
  /** positions paper par instId, notional USD signé */
  positions: Array<[string, number]>
  equityUsd: number
}

export interface RunnerState {
  version: 2
  regime1: {
    anchorTs: number | null
    lastTargets: { weights: Array<[string, number]>; btc: number; note: string } | null
    book: StratBook
  }
  listing2: {
    slots: Array<{ symbol: string; a: number; entryT: number; entryCum: number }>
    seenSymbols: string[]
    book: StratBook
  }
  history: Array<{ day: string; equity: number; r1: number; l2: number; note: string }>
  lastTickDay: string | null
}

export interface RunnerConfig {
  sleeveR1Usd: number
  sleeveL2Usd: number
  mode: 'paper' | 'dry'
  statePath: string
  killPath: string
  telegram?: (msg: string) => void
}

const GROSS_CAP_MULT = 2.2
const MAX_STALE_MS = 36 * 3_600_000

export function loadState(path: string): RunnerState {
  if (existsSync(path)) {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as RunnerState
    if (raw.version === 2) return raw
  }
  return {
    version: 2,
    regime1: { anchorTs: null, lastTargets: null, book: { positions: [], equityUsd: 0 } },
    listing2: { slots: [], seenSymbols: [], book: { positions: [], equityUsd: 0 } },
    history: [],
    lastTickDay: null,
  }
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
    const instruments = await fetchSwapInstruments()
    const rExecRow = (a: number, j: number): number => {
      const na = ctx.spot.na
      const rp = Math.log(ctx.perp.px[j * na + a] / ctx.perp.px[(j - 1) * na + a])
      if (Number.isFinite(rp)) return rp
      const rs = Math.log(ctx.spot.px[j * na + a] / ctx.spot.px[(j - 1) * na + a])
      return Number.isFinite(rs) ? rs : 0
    }

    // ---------- REGIME1 (sleeve régimée, K7 ancré)
    if (state.regime1.anchorTs === null) state.regime1.anchorTs = dayMs
    const isRebal = Math.round((dayMs - state.regime1.anchorTs) / DAY) % K_REGIME === 0
    const prev: TargetWeights | null = state.regime1.lastTargets
      ? { weights: new Map(state.regime1.lastTargets.weights), btc: state.regime1.lastTargets.btc, note: state.regime1.lastTargets.note }
      : null
    const tg = regime1Targets(ctx, isRebal, prev)
    const g = gateValue(ctx)
    this.say(`📊 regime1 ${day} — porte ${(g * 1e4).toFixed(2)} bps/j (seuil ${GATE_BPS}) · ${isRebal ? 'REBAL' : 'tenue'} · ${tg.note}`)
    const gross = [...tg.weights.values()].reduce((s, w) => s + Math.abs(w), 0) + Math.abs(tg.btc)
    let planR1: RebalancePlan | null = null
    if (gross > GROSS_CAP_MULT) {
      this.say(`🛑 regime1 : plafond brut dépassé (${gross.toFixed(2)}× > ${GROSS_CAP_MULT}) — abstention stratégie`)
    } else {
      const positions = new Map(state.regime1.book.positions)
      planR1 = planRebalance(tg.weights, tg.btc, this.cfg.sleeveR1Usd, positions, instruments)
      const adapter = new OkxPortfolioAdapter()
      await adapter.execute(planR1, (m) => this.say(`[r1] ${m}`))
      if (this.cfg.mode === 'paper') this.markBook(state.regime1.book, ctx, btcR, planR1, rExecRow)
      state.regime1.lastTargets = { weights: [...tg.weights.entries()], btc: tg.btc, note: tg.note }
    }

    // ---------- LISTING2 (slots événementiels)
    const l2state: Listing2State = {
      slots: state.listing2.slots.map((s) => ({ ...s })),
      seen: new Set(state.listing2.seenSymbols.map((s) => ctx.spot.syms.indexOf(s)).filter((i) => i >= 0)),
    }
    const dec = listing2Step(ctx, l2state, rExecRow)
    this.say(`🏷️ listing2 ${day} — ${dec.note}`)
    const slotUsd = this.cfg.sleeveL2Usd / 10
    const l2weights = new Map<string, number>()
    for (const s of [...dec.hold, ...dec.open]) l2weights.set(s.symbol, (l2weights.get(s.symbol) ?? 0) - slotUsd / this.cfg.sleeveL2Usd)
    const l2btc = ([...dec.hold, ...dec.open].length * slotUsd) / this.cfg.sleeveL2Usd
    const posL2 = new Map(state.listing2.book.positions)
    const planL2 = planRebalance(l2weights, l2btc, this.cfg.sleeveL2Usd, posL2, instruments)
    const adapter2 = new OkxPortfolioAdapter()
    await adapter2.execute(planL2, (m) => this.say(`[l2] ${m}`))
    if (this.cfg.mode === 'paper') this.markBook(state.listing2.book, ctx, btcR, planL2, rExecRow)
    state.listing2.slots = [...dec.hold, ...dec.open].map((s) => ({ symbol: s.symbol, a: s.a, entryT: s.entryT, entryCum: s.entryCum }))
    state.listing2.seenSymbols = [...new Set([...state.listing2.seenSymbols, ...[...l2state.seen].map((i) => ctx.spot.syms[i]).filter(Boolean)])]

    // ---------- consolidation
    const total = state.regime1.book.equityUsd + state.listing2.book.equityUsd
    state.history.push({
      day, equity: Math.round(total * 100) / 100,
      r1: Math.round(state.regime1.book.equityUsd * 100) / 100,
      l2: Math.round(state.listing2.book.equityUsd * 100) / 100,
      note: `${state.regime1.book.positions.length}+${state.listing2.book.positions.length} positions`,
    })
    state.lastTickDay = day
    saveState(this.cfg.statePath, state)
    this.say(`💼 paper total ${total.toFixed(2)} USDT (r1 ${state.regime1.book.equityUsd.toFixed(2)} · l2 ${state.listing2.book.equityUsd.toFixed(2)})`)
  }

  /** mark-to-close du book + application du plan (coûts provisionnés) */
  private markBook(
    book: StratBook, ctx: DayContext, btcR: Float64Array,
    plan: RebalancePlan, rExecRow: (a: number, j: number) => number,
  ): void {
    const { spot, fund, t } = ctx
    const idBySym = new Map(spot.syms.map((s, a) => [toOkxInstId(s), a]))
    const positions = new Map(book.positions)
    let pnl = 0
    for (const [instId, notional] of positions) {
      if (notional === 0) continue
      if (instId === 'BTC-USDT-SWAP') {
        pnl += btcR[t] * notional - fund.btcDaily[t] * notional
        continue
      }
      const a = idBySym.get(instId)
      if (a === undefined) continue
      pnl += rExecRow(a, t) * notional - fund.F[t * spot.na + a] * notional
    }
    for (const o of plan.orders) {
      pnl -= 0.003 * o.notionalUsd
      const signed = (o.side === 'buy' ? 1 : -1) * o.notionalUsd
      positions.set(o.instId, (positions.get(o.instId) ?? 0) + signed)
    }
    for (const [id, v] of positions) if (Math.abs(v) < 1) positions.delete(id)
    book.equityUsd += pnl
    book.positions = [...positions.entries()]
  }
}

export function defaultPaths(): { statePath: string; killPath: string } {
  const root = resolve(import.meta.dir, '../../../..')
  return {
    statePath: resolve(root, 'apps/backend/src/portfolio/.paper-state.json'),
    killPath: resolve(root, 'portfolio.KILL'),
  }
}
