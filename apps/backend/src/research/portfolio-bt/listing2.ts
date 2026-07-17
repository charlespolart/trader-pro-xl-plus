/** portfolio-bt — stratégie LISTING2 (candidat n°2) : short des nouveaux
 *  listings Binance. Réplique EXACTE de listing2/strategy.py (cellule jugée
 *  S2 K30 stop) — parité : ère mécanique Sharpe 1,31/Calmar 2,16.
 *  Événement : listing spot Binance dont le perp a du funding ≤ J+7 ;
 *  entrée au close du 1er jour de funding ; short 1 slot + long BTC 1:1 ;
 *  K = 30 j ; stop au close à +50 % ; M = 10 slots (skip si plein). */
import { COST, WARMUP, type FundingPanel, type Panel } from './data'
import { dateMs, metrics, type Metrics } from './engine'

export const K_HOLD = 30
export const STOP_LOG = Math.log(1.5)
export const M_SLOTS = 10
export const EV_START = dateMs('2019-02-01')
export const EV_END = dateMs('2026-06-01')

export interface ListingEvent {
  a: number
  te: number                  // index d'entrée (1er jour de funding observé)
}

export function buildEvents(spot: Panel, fund: FundingPanel, hist: Float64Array): ListingEvent[] {
  const { n, na, px, ts } = spot
  const events: ListingEvent[] = []
  for (let a = 0; a < na; a++) {
    let first = -1
    let last = -1
    for (let i = 0; i < n; i++) {
      if (Number.isFinite(px[i * na + a])) {
        if (first === -1) first = i
        last = i
      }
    }
    if (first === -1) continue
    if (ts[first] < EV_START || ts[first] >= EV_END) continue
    let alive = 0
    for (let b = 0; b < na; b++) {
      if (Number.isFinite(px[first * na + b]) && hist[first * na + b] >= WARMUP) alive++
    }
    if (alive < 30) continue
    let te = -1
    for (let i = first; i <= Math.min(first + 7, n - 1); i++) {
      if (fund.F[i * na + a] !== 0) {
        te = i
        break
      }
    }
    if (te === -1) continue
    if (te + 8 > n || last < te + 7) continue
    events.push({ a, te })
  }
  return events.sort((x, y) => x.te - y.te)
}

export interface Listing2Result extends Metrics {
  trades: number[]
  skipped: number
  daily: Float64Array
}

/** portefeuille S2 K30 stop sur toute la série (pnl quotidien / M slots) */
export function runListing2(spot: Panel, rExec: Float64Array, fund: FundingPanel,
                            btcR: Float64Array, events: ListingEvent[], costMult = 1): Float64Array & { trades?: number[] } {
  const { n, na } = spot
  const pnl = new Float64Array(n)
  const openUntil: number[] = []
  const trades: number[] = []
  let skipped = 0
  for (const { a, te } of events) {
    for (let i = openUntil.length - 1; i >= 0; i--) if (openUntil[i] <= te) openUntil.splice(i, 1)
    if (openUntil.length >= M_SLOTS) {
      skipped++
      continue
    }
    let tEnd = Math.min(te + K_HOLD, n - 1)
    let cum = 0
    for (let j = te + 1; j <= Math.min(te + K_HOLD, n - 1); j++) {
      cum += rExec[j * na + a]
      if (cum >= STOP_LOG) {
        tEnd = j
        break
      }
    }
    let tradePnl = 0
    for (let j = te + 1; j <= tEnd; j++) {
      let d = -rExec[j * na + a] + fund.F[j * na + a]        // short : −prix, reçoit F
      d += btcR[j] - fund.btcDaily[j]                        // long BTC perp − funding
      if (j === te + 1) d -= COST * costMult
      if (j === tEnd) d -= COST * costMult
      pnl[j] += d / M_SLOTS
      tradePnl += d
    }
    trades.push(tradePnl)
    openUntil.push(tEnd)
  }
  const out = pnl as Float64Array & { trades?: number[]; skipped?: number }
  out.trades = trades
  out.skipped = skipped
  return out
}

export function metricsSeg(daily: Float64Array, ts: Float64Array, a: string, b: string): Metrics {
  const lo = tsIndex(ts, dateMs(a))
  const hi = tsIndex(ts, dateMs(b))
  return metrics(daily.slice(lo, hi))
}

function tsIndex(ts: Float64Array, v: number): number {
  let lo = 0
  let hi = ts.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (ts[mid] < v) lo = mid + 1
    else hi = mid
  }
  return lo
}
