/**
 * PortfolioRunner — couche « CIBLES DU JOUR » (Phase A, lot A1).
 *
 * Code NOUVEAU, non branché au runtime (aucun import depuis les services
 * live) : traduit les deux stratégies validées en cibles de portefeuille
 * datées, en RÉUTILISANT la logique de research/portfolio-bt (dont la
 * parité avec la validation python est prouvée au centième).
 *
 * regime1 : porte médiane funding ≥ 2,5 bps/j → short quintile funding-max
 * (FLEVEL 3 j) + long BTC 1:1, rebalancement K = 7 j.
 * listing2 : short des nouveaux listings Binance ayant un perp (entrée au
 * 1er funding observé), + long BTC 1:1 par slot, K = 30 j, stop close
 * +50 %, M = 10 slots.
 */
import { MIN_ALIVE, TOPQ, WARMUP, type FundingPanel, type Panel } from '../research/portfolio-bt/data'
import { argsortAsc, median } from '../research/portfolio-bt/engine'
import { GATE_BPS, FLEVEL_L, K as K_REGIME } from '../research/portfolio-bt/regime1'
import { K_HOLD, M_SLOTS, STOP_LOG } from '../research/portfolio-bt/listing2'

export interface DayContext {
  /** index du jour courant dans les panels (dernier close disponible) */
  t: number
  spot: Panel
  perp: Panel
  fund: FundingPanel
  /** cumul de closes finis par [t*na+a] (histFinite) */
  hist: Float64Array
}

export interface TargetWeights {
  /** poids par symbole Binance (négatif = short), unité = fraction de la sleeve */
  weights: Map<string, number>
  /** poids BTC (long/short), même unité */
  btc: number
  /** diagnostic lisible pour les logs/Telegram */
  note: string
}

function eligibleAt(ctx: DayContext, a: number, withSignal: boolean, S?: Float64Array): boolean {
  const { t, spot, fund, hist } = ctx
  const k = t * spot.na + a
  if (withSignal && !(S && Number.isFinite(S[k]))) return false
  return Number.isFinite(spot.px[k]) && hist[k] >= WARMUP
    && fund.cnt[k] >= 21 && fund.lastev[k] <= 2
}

/** signal FLEVEL au jour t uniquement (−Σ funding des L derniers jours) */
function flevelRow(ctx: DayContext): Float64Array {
  const { t, spot, fund } = ctx
  const { na } = spot
  const S = new Float64Array(spot.n * na).fill(NaN)
  if (t < FLEVEL_L) return S
  for (let a = 0; a < na; a++) {
    let acc = 0
    for (let j = t - FLEVEL_L + 1; j <= t; j++) acc += fund.F[j * na + a]
    S[t * na + a] = -acc
  }
  return S
}

/** la porte de régime au jour t (médiane du funding des éligibles) */
export function gateValue(ctx: DayContext): number {
  const vals: number[] = []
  for (let a = 0; a < ctx.spot.na; a++) {
    if (eligibleAt(ctx, a, false)) vals.push(ctx.fund.F[ctx.t * ctx.spot.na + a])
  }
  return vals.length >= MIN_ALIVE ? median(vals) : NaN
}

/**
 * Cibles regime1 au jour t. `isRebalanceDay` est fourni par le runner (la
 * grille K7 est ancrée sur la date de mise en service et persistée — même
 * convention que le backtest qui ancre sur le début de fenêtre).
 */
export function regime1Targets(ctx: DayContext, isRebalanceDay: boolean, previous: TargetWeights | null): TargetWeights {
  if (!isRebalanceDay && previous) {
    // suffixe IDEMPOTENT : previous.note est persisté et déjà suffixé les jours
    // hors-rebal précédents — ré-append aveugle = note qui gonfle d'un « (hors
    // rebal…) » par nuit (vécu : ×4 au 2026-07-21). N'ajouter qu'une fois.
    const suffix = ' (hors rebal, positions tenues)'
    return { ...previous, note: previous.note.endsWith(suffix) ? previous.note : previous.note + suffix }
  }
  const g = gateValue(ctx)
  const on = Number.isFinite(g) && g >= GATE_BPS / 1e4
  if (!on) return { weights: new Map(), btc: 0, note: `porte OFF (médiane ${(g * 1e4).toFixed(2)} bps/j < ${GATE_BPS})` }
  const S = flevelRow(ctx)
  const idx: number[] = []
  for (let a = 0; a < ctx.spot.na; a++) if (eligibleAt(ctx, a, true, S)) idx.push(a)
  if (idx.length < MIN_ALIVE) return { weights: new Map(), btc: 0, note: `porte ON mais ${idx.length} éligibles < ${MIN_ALIVE}` }
  const ntop = Math.max(1, Math.round(idx.length * TOPQ))
  const rowS = new Float64Array(ctx.spot.na)
  for (const a of idx) rowS[a] = S[ctx.t * ctx.spot.na + a]
  const order = argsortAsc(rowS, idx)
  const weights = new Map<string, number>()
  for (let j = 0; j < ntop; j++) weights.set(ctx.spot.syms[order[j]], -1 / ntop)
  return {
    weights, btc: 1,
    note: `porte ON (${(g * 1e4).toFixed(2)} bps/j) — short ${ntop}/${idx.length} éligibles + long BTC 1:1`,
  }
}

export interface ListingSlot {
  symbol: string
  a: number
  entryT: number
  entryCum: number             // cumul de log-returns depuis l'entrée (pour le stop)
}

export interface Listing2State {
  slots: ListingSlot[]
  /** index spot déjà traités (événements consommés ou sautés) */
  seen: Set<number>
}

export interface Listing2Decision {
  open: ListingSlot[]
  close: ListingSlot[]
  hold: ListingSlot[]
  note: string
}

/**
 * Décisions listing2 au jour t : ouvre les nouveaux événements (listing
 * Binance dont le funding du perp vient d'apparaître, ≤ J+7 du listing),
 * ferme sur K30/stop. La disponibilité du perp OKX est vérifiée par
 * l'ADAPTATEUR (pas ici) : un événement sans instrument OKX est sauté au
 * moment de l'exécution — même convention que la validation (55 % couverts).
 */
export function listing2Step(ctx: DayContext, state: Listing2State, rExecRow: (a: number, j: number) => number): Listing2Decision {
  const { t, spot, fund } = ctx
  const { na } = spot
  const open: ListingSlot[] = []
  const close: ListingSlot[] = []
  const hold: ListingSlot[] = []
  for (const slot of state.slots) {
    const held = t - slot.entryT
    slot.entryCum += rExecRow(slot.a, t)
    if (held >= K_HOLD || slot.entryCum >= STOP_LOG) close.push(slot)
    else hold.push(slot)
  }
  for (let a = 0; a < na; a++) {
    if (state.seen.has(a)) continue
    let first = -1
    for (let i = Math.max(0, t - 10); i <= t; i++) {
      if (Number.isFinite(spot.px[i * na + a]) && (i === 0 || !Number.isFinite(spot.px[(i - 1) * na + a]))) {
        first = i
        break
      }
    }
    if (first === -1) continue
    if (fund.F[t * na + a] === 0) {
      if (t - first > 7) state.seen.add(a)     // fenêtre J+7 expirée sans perp
      continue
    }
    state.seen.add(a)
    if (hold.length + open.length >= M_SLOTS) continue        // slots pleins → sauté
    open.push({ symbol: spot.syms[a], a, entryT: t, entryCum: 0 })
  }
  return { open, close, hold, note: `${hold.length} tenus, ${open.length} ouverts, ${close.length} fermés` }
}
