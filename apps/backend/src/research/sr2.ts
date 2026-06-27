/**
 * S/R — passe 2 : résistances SIGNIFICATIVES (pivots larges, rares) + test de
 * REJET DIRECT (le prix tape le niveau) + les rachats réels de la v2.
 * Question : une résistance significative ajoute-t-elle de l'info AU-DELÀ du
 * simple « on est en bear » ? (compare fwd touche-résistance vs baseline bear)
 *   bun apps/backend/src/research/sr2.ts
 */
import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import accumV2 from '../../../../strategies/btc-accumulator-v2'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../data') })
const START = Date.parse('2019-01-01T00:00:00Z')
const END = Date.parse('2026-06-13T00:00:00Z')
const candles = await provider.getCandles('spot', 'BTCUSDT', '4h', START, END)
const n = candles.length
const high = candles.map((c) => c.high)
const close = candles.map((c) => c.close)
const openT = candles.map((c) => c.openTime)
function ema(vals: number[], len: number): number[] {
  const k = 2 / (len + 1)
  const out: number[] = []
  let p = vals[0]!
  for (let i = 0; i < vals.length; i++) {
    p = i === 0 ? vals[0]! : vals[i]! * k + p * (1 - k)
    out.push(p)
  }
  return out
}
const ema50 = ema(close, 50)
const f = (v: number, d = 2): string => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '—')
const SLOPE = 30
const bear = (i: number): boolean => i >= SLOPE && ema50[i]! < ema50[i - SLOPE]!

// résistances significatives : pivots fractals larges (L), validité W
function buildSwings(L: number): number[] {
  const out: number[] = []
  for (let i = L; i < n - L; i++) {
    let ok = true
    for (let j = i - L; j <= i + L; j++)
      if (high[j]! > high[i]!) {
        ok = false
        break
      }
    if (ok) out.push(i)
  }
  return out
}
function nearestRes(swings: number[], L: number, W: number, i: number): number | null {
  let best = Infinity
  for (const sh of swings) {
    if (sh + L > i) break
    if (i - sh > W) continue
    const r = high[sh]!
    if (r > close[i]! && r < best) best = r
  }
  return best === Infinity ? null : best
}

// ---- A) test de REJET DIRECT à une résistance significative
for (const [L, W] of [[8, 240], [12, 360]] as const) {
  const swings = buildSwings(L)
  const K = 20
  let touchN = 0, touchSum = 0, touchNeg = 0, breakout = 0
  let baseN = 0, baseSum = 0, baseNeg = 0
  for (let i = SLOPE; i < n - K; i++) {
    if (!bear(i)) continue
    const fwd = close[i + K]! / close[i]! - 1
    baseN++; baseSum += fwd; if (fwd < 0) baseNeg++
    const r = nearestRes(swings, L, W, i)
    if (r === null) continue
    // touche : le HAUT atteint la résistance ce bar, alors qu'on était dessous
    const touch = high[i]! >= r * 0.997 && high[i - 1]! < r * 0.997
    if (!touch) continue
    touchN++; touchSum += fwd; if (fwd < 0) touchNeg++
    // cassure : un close dépasse la résistance dans les K bougies
    for (let j = i + 1; j <= i + K; j++) if (close[j]! > r) { breakout++; break }
  }
  console.log(`\n=== A) Rejet à résistance significative (pivot ±${L} bougies, fenêtre ${W}), bear, fwd ${K} bougies ===`)
  console.log(`  baseline bear (toutes barres) : n=${baseN}  fwd moy ${f((baseSum / baseN) * 100, 2)}%  %down ${((baseNeg / baseN) * 100).toFixed(0)}%`)
  console.log(`  touche la résistance          : n=${touchN}  fwd moy ${f((touchSum / Math.max(1, touchN)) * 100, 2)}%  %down ${((touchNeg / Math.max(1, touchN)) * 100).toFixed(0)}%  | cassure ${((breakout / Math.max(1, touchN)) * 100).toFixed(0)}%`)
  console.log(`  → la résistance aide SEULEMENT si fwd(touche) nettement < fwd(baseline) ET %down nettement plus haut`)
}

// ---- B) les rachats RÉELS de la v2 : distance à la résistance vs « manque à gagner »
function cfg(params: ParamValues): BacktestConfig {
  return {
    strategyId: 'btc-accumulator-v2', params, market: 'spot', symbol: 'BTCUSDT', start: START, end: END,
    initialBalance: 1, denomination: 'base', leverage: 1,
    fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
    fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
    fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
  }
}
const res = await runBacktest({ config: cfg({}), def: accumV2, provider })
const swings = buildSwings(8)
const idxAt = (t: number): number => {
  let lo = 0, hi = n - 1, best = 0
  while (lo <= hi) { const m = (lo + hi) >> 1; if (openT[m]! <= t) { best = m; lo = m + 1 } else hi = m - 1 }
  return best
}
const K = 20
let nearN = 0, nearMiss = 0, nearMissSum = 0
let farN = 0, farMiss = 0, farMissSum = 0
for (const t of res.trades) {
  if (t.exitTime === null) continue
  const i = idxAt(t.exitTime)
  if (i + K >= n) continue
  const r = nearestRes(swings, 8, 240, i)
  const dist = r !== null ? (r - close[i]!) / close[i]! : Infinity
  const fwd = close[i + K]! / close[i]! - 1 // <0 = le prix a continué à BAISSER après le rachat = manque à gagner
  if (dist <= 0.02) { nearN++; if (fwd < 0) nearMiss++; nearMissSum += fwd }
  else { farN++; if (fwd < 0) farMiss++; farMissSum += fwd }
}
console.log(`\n=== B) Rachats v2 : a-t-on raté de la baisse ? (fwd<0 sur ${K} bougies après le rachat = on a racheté trop tôt) ===`)
console.log(`  rachat PRÈS d'une résistance (≤2%) : n=${nearN}  fwd moy ${f((nearMissSum / Math.max(1, nearN)) * 100, 2)}%  % qui rechutent ${((nearMiss / Math.max(1, nearN)) * 100).toFixed(0)}%`)
console.log(`  rachat LOIN d'une résistance        : n=${farN}  fwd moy ${f((farMissSum / Math.max(1, farN)) * 100, 2)}%  % qui rechutent ${((farMiss / Math.max(1, farN)) * 100).toFixed(0)}%`)
console.log(`  (échantillon faible, indicatif)`)
process.exit(0)
