/**
 * Comparatifs honnêtes pour le doc BTC Swing : sur les MÊMES périodes et aux
 * MÊMES coûts (taker 10 bps + slip 5 par côté), trois lignes :
 *   1. B&H pur (acheter au début, revendre à la fin) ;
 *   2. B&H gaté régime : détenir BTC quand close 1d > EMA200 (bascule à l'open
 *      du lendemain du signal, coûts à chaque bascule) — le benchmark
 *      « acheter/revendre à certains points » qui isole l'apport de la couche 4h ;
 *   3. BTC Swing (chiffres engine, rappelés en dur depuis wfswing/runswing).
 * Sorties : full 2019→2026-01, par année, par fenêtre WF (mêmes 6 fenêtres),
 * bear 2018, holdout. Net % + max drawdown (clôtures 1d) + exposition.
 *   bun apps/backend/src/research/dayswing/benchmarks.ts
 */
import { resolve } from 'node:path'
import { walkForwardWindows } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import type { Candle } from '@tpx/shared'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../data') })
const DAY = 86_400_000
const SIDE = 0.0015 // 10 bps taker + 5 slip, par côté

const d1 = await provider.getCandles('spot', 'BTCUSDT', '1d', Date.parse('2017-06-01T00:00:00Z'), Date.parse('2026-07-01T00:00:00Z'))
// EMA200 1d + régime (connu à la clôture du jour j, appliqué à l'open j+1)
const ema200: number[] = new Array(d1.length).fill(NaN)
{
  const k = 2 / 201
  let ema = NaN
  const seed: number[] = []
  for (let i = 0; i < d1.length; i++) {
    if (Number.isNaN(ema)) {
      seed.push(d1[i].close)
      if (seed.length === 200) ema = seed.reduce((a, b) => a + b, 0) / 200
    } else ema = d1[i].close * k + ema * (1 - k)
    ema200[i] = ema
  }
}
const idxAt = (t: number) => d1.findIndex((c) => c.openTime >= t)

function maxDD(equity: number[]): number {
  let peak = -Infinity
  let dd = 0
  for (const e of equity) {
    peak = Math.max(peak, e)
    dd = Math.min(dd, e / peak - 1)
  }
  return dd * 100
}

/** B&H pur : achat open du 1er jour, vente close du dernier ; DD sur closes */
function buyHold(start: number, end: number) {
  const i0 = idxAt(start)
  let i1 = d1.findIndex((c) => c.openTime >= end)
  if (i1 < 0) i1 = d1.length
  const entry = d1[i0].open * (1 + SIDE)
  const equity: number[] = []
  for (let i = i0; i < i1; i++) equity.push(d1[i].close / entry)
  const exit = d1[i1 - 1].close * (1 - SIDE)
  return { net: (exit / entry - 1) * 100, dd: maxDD(equity), expo: 100 }
}

/** B&H gaté EMA200 1d : bascule à l'open du lendemain du cross, coûts par côté */
function regimeHold(start: number, end: number) {
  const i0 = idxAt(start)
  let i1 = d1.findIndex((c) => c.openTime >= end)
  if (i1 < 0) i1 = d1.length
  let cash = 1
  let btc = 0
  let holding = false
  let switches = 0
  let daysIn = 0
  const equity: number[] = []
  for (let i = i0; i < i1; i++) {
    // signal de la veille (aucun lookahead)
    const sig = i > 0 && Number.isFinite(ema200[i - 1]) ? d1[i - 1].close > ema200[i - 1] : false
    if (sig !== holding) {
      if (sig) {
        btc = (cash * (1 - SIDE)) / d1[i].open
        cash = 0
      } else {
        cash = btc * d1[i].open * (1 - SIDE)
        btc = 0
      }
      holding = sig
      switches++
    }
    if (holding) daysIn++
    equity.push(cash + btc * d1[i].close)
  }
  const final = cash + btc * d1[i1 - 1].close * (holding ? 1 - SIDE : 1)
  return { net: (final - 1) * 100, dd: maxDD(equity), expo: (daysIn / (i1 - i0)) * 100, switches }
}

/** DCA hebdomadaire : budget 1 réparti en achats égaux tous les 7 jours, jamais vendu.
 *  DD sur la valeur TOTALE (cash pas encore déployé + BTC) ; expo = part moyenne en BTC. */
function dca(start: number, end: number) {
  const i0 = idxAt(start)
  let i1 = d1.findIndex((c) => c.openTime >= end)
  if (i1 < 0) i1 = d1.length
  const nWeeks = Math.max(1, Math.floor((i1 - i0) / 7))
  const perBuy = 1 / nWeeks
  let cash = 1
  let btc = 0
  let expoSum = 0
  const equity: number[] = []
  for (let i = i0; i < i1; i++) {
    if ((i - i0) % 7 === 0 && cash > 1e-9) {
      const spend = Math.min(perBuy, cash)
      btc += (spend * (1 - SIDE)) / d1[i].open
      cash -= spend
    }
    const val = cash + btc * d1[i].close
    equity.push(val)
    expoSum += (btc * d1[i].close) / val
  }
  const final = cash + btc * d1[i1 - 1].close * (1 - SIDE)
  return { net: (final - 1) * 100, dd: maxDD(equity), expo: (expoSum / (i1 - i0)) * 100 }
}

const f = (v: number, d = 1): string => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '—')
function row(label: string, start: string, end: string): void {
  const s = Date.parse(`${start}T00:00:00Z`)
  const e = Date.parse(`${end}T00:00:00Z`)
  const bh = buyHold(s, e)
  const rg = regimeHold(s, e)
  const dc = dca(s, e)
  console.log(
    label.padEnd(24) +
      `B&H ${f(bh.net).padStart(9)}% (DD ${f(bh.dd, 0).padStart(4)}%)` +
      `   régime ${f(rg.net).padStart(9)}% (DD ${f(rg.dd, 0).padStart(4)}%, ${String(rg.switches).padStart(2)} bascules, expo ${rg.expo.toFixed(0)}%)` +
      `   DCA hebdo ${f(dc.net).padStart(8)}% (DD ${f(dc.dd, 0).padStart(4)}%, expo ${dc.expo.toFixed(0)}%)`,
  )
}

console.log('══ Full + stress + holdout ══')
row('2019 → 2026-01', '2019-01-01', '2026-01-01')
row('bear 2018', '2018-05-01', '2019-01-01')
row('holdout 2026-01→07', '2026-01-01', '2026-07-01')

console.log('\n══ Par année ══')
for (let y = 2019; y <= 2025; y++) row(String(y), `${y}-01-01`, `${y + 1}-01-01`)

console.log('\n══ Fenêtres walk-forward (mêmes bornes que wfswing) ══')
const windows = walkForwardWindows(Date.parse('2019-01-01T00:00:00Z'), Date.parse('2026-01-01T00:00:00Z'), { windows: 6, isRatio: 0.6, anchored: false })
let bhComp = 1
let rgComp = 1
for (const w of windows) {
  const ds = new Date(w.oosStart).toISOString().slice(0, 10)
  const de = new Date(w.oosEnd).toISOString().slice(0, 10)
  const bh = buyHold(w.oosStart, w.oosEnd)
  const rg = regimeHold(w.oosStart, w.oosEnd)
  bhComp *= 1 + bh.net / 100
  rgComp *= 1 + rg.net / 100
  console.log(`${ds}→${de}`.padEnd(24) + `B&H ${f(bh.net).padStart(8)}%   régime ${f(rg.net).padStart(8)}%`)
}
console.log(`\ncomposé OOS : B&H ${f((bhComp - 1) * 100)}% · régime ${f((rgComp - 1) * 100)}% · (BTC Swing : +294,4 %)`)
process.exit(0)
