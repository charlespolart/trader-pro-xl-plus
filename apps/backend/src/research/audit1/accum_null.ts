/**
 * audit1/A6 — RECONSTRUCTION du null timing-aveugle de btc-accumulator
 * (l'original de juin — « médiane −22 %, percentile 97,3 » — n'est plus dans
 * l'arbre ; seul le résultat survivait dans accum2/LOG.md).
 *
 * Protocole (pré-déclaré, pattern validé de accum3/vrx_validate.py) :
 *  1. moteur réel → excursions de la v2 (défauts) sur la fenêtre full
 *     2018-04→2026-07 : n excursions, durées en barres 4h ;
 *  2. bras réel ET bras null dans la MÊME comptabilité close→close en BTC
 *     (v ×= c[j−1]/c[j] en excursion, frais 0,15 %/transition) — pas de
 *     mélange moteur-vs-replay ;
 *  3. null : mêmes durées, départs aléatoires NON chevauchants tirés parmi
 *     les barres 4h en RÉGIME BEAR (tendance 3d EMA60 déclin-8 sous la MA ET
 *     confirmation 1d EMA200 déclin-30 sous la MA — le contexte que la
 *     stratégie exige pour VENDRE), 300 tirages ;
 *  4. percentile du réel. Attendu si la mécanique d'excursion est réelle :
 *     percentile élevé (l'original donnait 97,3 sur une fenêtre voisine).
 *   DATABASE_URL=postgres://tpx:tpx@localhost:5438/tpx bun apps/backend/src/research/audit1/accum_null.ts
 */
import { resolve } from 'node:path'
import { emaStream, runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, INTERVAL_MS, type BacktestConfig, type ParamValues } from '@tpx/shared'
import accumV2 from '../../../../../strategies/btc-accumulator'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5438/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../../data'), autoEnsure: false })

const START = Date.parse('2018-04-05T00:00:00Z')
const END = Date.parse('2026-07-01T00:00:00Z')
const FEE = 0.0015
const DRAWS = 300

// ---- 1. moteur réel : excursions de la v2
const config: BacktestConfig = {
  strategyId: 'btc-accumulator-v2', params: {} as ParamValues, market: 'spot', symbol: 'BTCUSDT',
  start: START, end: END, initialBalance: 1, denomination: 'base', leverage: 1,
  fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
  fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
  fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
}
const res = await runBacktest({ config, def: accumV2, provider })
const excursions = res.trades
  .filter((t) => t.exitTime !== null)
  .map((t) => ({ a: t.entryTime, b: t.exitTime! }))
console.log(`moteur : net ${res.metrics.netProfitPct.toFixed(1)}% BTC, ${excursions.length} excursions closes`)

// ---- données 4h + régime bear (3d EMA60 déclin-8 + 1d EMA200 déclin-30)
const H4 = 14_400_000
const cs = await provider.getCandles('spot', 'BTCUSDT', '4h', START - 30 * 86_400_000, END)
const d3 = await provider.getCandles('spot', 'BTCUSDT', '3d', START - 280 * 86_400_000, END)
const d1 = await provider.getCandles('spot', 'BTCUSDT', '1d', START - 320 * 86_400_000, END)

function maSeries(candles: { close: number }[], len: number): (number | null)[] {
  const s = emaStream(len)
  return candles.map((c) => s(c.close))
}
/** bear[i] sur le TF lent : close < EMA ET EMA(i−slope) > EMA(i) */
function bearFlags(candles: { close: number }[], len: number, slope: number): boolean[] {
  const ma = maSeries(candles, len)
  return candles.map((c, i) => {
    const m = ma[i]
    const past = i >= slope ? ma[i - slope] : null
    return m !== null && past !== null && c.close < m && past > m
  })
}
const bear3d = bearFlags(d3, 60, 8)
const bear1d = bearFlags(d1, 200, 30)

/** dernier index du TF lent dont closeTime < t (convention moteur : petit TF servi d'abord) */
function lastVisible(cts: number[], t: number): number {
  let lo = 0
  let hi = cts.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cts[mid]! < t) lo = mid + 1
    else hi = mid
  }
  return lo - 1
}
const ct3 = d3.map((c) => c.closeTime)
const ct1 = d1.map((c) => c.closeTime)
const bearAt4h: boolean[] = cs.map((c) => {
  const i3 = lastVisible(ct3, c.closeTime)
  const i1 = lastVisible(ct1, c.closeTime)
  return i3 >= 0 && i1 >= 0 && bear3d[i3]! && bear1d[i1]!
})

// fenêtre d'étude : barres 4h dans [START, END)
const idx: number[] = []
for (let i = 0; i < cs.length; i++) {
  if (cs[i]!.openTime >= START && cs[i]!.openTime < END) idx.push(i)
}
const closes = idx.map((i) => cs[i]!.close)
const bear = idx.map((i) => bearAt4h[i]!)
const timeToJ = new Map<number, number>()
idx.forEach((i, j) => timeToJ.set(cs[i]!.openTime, j))

// ---- 2. bras réel en comptabilité replay (close→close, frais aux transitions)
function replay(episodes: Array<{ s: number; d: number }>): number {
  const pos = new Uint8Array(closes.length).fill(1) // 1 = BTC détenu, 0 = vendu
  for (const { s, d } of episodes) {
    for (let j = s; j < Math.min(s + d, closes.length); j++) pos[j] = 0
  }
  let v = 1
  let st = 1
  for (let j = 1; j < closes.length; j++) {
    if (pos[j] !== st) {
      v *= 1 - FEE
      st = pos[j]!
    }
    if (st === 0) v *= closes[j - 1]! / closes[j]!
  }
  return (v - 1) * 100
}

// Bras réel = multiplicateurs RÉELS du moteur (stops intrabar, slippage,
// frais inclus) : la mécanique d'excursion (cap -5 %, recross) fait partie de
// l'HYPOTHÈSE testée. Le null, lui, n'a pas de mécanique : il subit le
// close→close aveugle sur les mêmes durées (vérifié au debug : le replay
// close→close sous-estime les pertes stoppées de 2-6 pts → inutilisable pour
// le bras réel).
const closedTrades = res.trades.filter((t) => t.exitTime !== null)
const realNet = (closedTrades.reduce((v, t) => v * (1 + t.realizedPnlPct / 100), 1) - 1) * 100
const durations = excursions.map((e) => Math.max(1, Math.round((e.b - e.a) / H4)))

// ---- 3. null : mêmes durées, départs aléatoires en bear, non chevauchants
let seed = 0xacc0
const rand = (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}
const bearIdx: number[] = []
bear.forEach((b, j) => {
  if (b) bearIdx.push(j)
})
console.log(`contexte : ${bearIdx.length}/${closes.length} barres 4h en régime bear (${((bearIdx.length / closes.length) * 100).toFixed(1)}%)`)

const nulls: number[] = []
for (let dnum = 0; dnum < DRAWS; dnum++) {
  const occupied = new Uint8Array(closes.length)
  const episodes: Array<{ s: number; d: number }> = []
  for (const d of durations) {
    for (let attempt = 0; attempt < 500; attempt++) {
      const s = bearIdx[Math.floor(rand() * bearIdx.length)]!
      if (s + d + 1 >= closes.length) continue
      let free = true
      for (let j = s; j <= s + d && free; j++) if (occupied[j]) free = false
      if (!free) continue
      for (let j = s; j <= s + d; j++) occupied[j] = 1
      episodes.push({ s, d })
      break
    }
  }
  nulls.push(replay(episodes))
}
nulls.sort((a, b) => a - b)
const below = nulls.filter((x) => x < realNet).length
const q = (p: number): number => nulls[Math.min(nulls.length - 1, Math.floor(p * nulls.length))]!
console.log(
  `réel (moteur, produit des excursions) ${realNet.toFixed(1)}% · null méd ${q(0.5).toFixed(1)}% · ` +
  `p95 ${q(0.95).toFixed(1)}% · percentile du réel = ${((below / nulls.length) * 100).toFixed(1)}`,
)
process.exit(0)
