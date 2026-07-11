/**
 * Phase 1 — H5' : duel des porteurs de dérive 48h (le pivot post-D12).
 * L'intraday est clos ; la campagne cible désormais le swing 48-72h. Question :
 * quel signal d'entrée porte le mieux la dérive 48h+, et l'entrée MAKER
 * (limite au repos sous le signal pendant le chop initial) améliore-t-elle ou
 * détruit-elle (biais de sélection de fill à MESURER, pas à supposer) ?
 *
 * Signaux comparés (1h, dé-chevauchés, un trade à la fois) :
 *   A impulsion p85 × flow>0.5 × bull (D9)
 *   B cassure de compression q20 (24h) — sans flow/bull (D11 : n'ajoutent rien)
 *   C union A∪B ; D intersection A∩B
 * Exits (la seule forme survivante D10) : stop -300 bps, time-stop 48h/72h,
 * pas de TP. Entrées : taker open+1 (15 bps) VS maker limite à entry−δ
 * (δ∈{10,30} bps, 8 bps, valable 6h, signal abandonné si non rempli — le taux
 * de fill et la perf des NON-remplis sont rapportés = biais de sélection).
 *
 *   bun apps/backend/src/research/dayswing/h5swing.ts [--from=2019-01-01] [--to=2025-01-01] [--symbol=BTCUSDT]
 */
import { createDb } from '@tpx/db'
import { CandleStore } from '@tpx/data'

const arg = (name: string, dflt: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? dflt
const FROM = Date.parse(arg('from', '2019-01-01') + 'T00:00:00Z')
const TO = Date.parse(arg('to', '2025-01-01') + 'T00:00:00Z')
const SYMBOL = arg('symbol', 'BTCUSDT')
const DAY = 86_400_000
const TAKER = 15
const MAKER = 8

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN)
const sd = (v: number[]) => {
  if (v.length < 2) return NaN
  const m = mean(v)
  return Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / (v.length - 1))
}
const tstat = (v: number[]) => (v.length < 2 ? NaN : mean(v) / (sd(v) / Math.sqrt(v.length)))
const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
const fb = (x: number, w = 7) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(1) : '—').padStart(w)

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const store = new CandleStore(db)
const h1 = await store.getCandles('spot', SYMBOL, '1h', FROM - 30 * DAY, TO)
const d1 = await store.getCandles('spot', SYMBOL, '1d', FROM - 320 * DAY, TO)

const emaByDay = new Map<number, boolean>()
{
  const k = 2 / 201
  let ema = NaN
  const seed: number[] = []
  for (const c of d1) {
    if (Number.isNaN(ema)) {
      seed.push(c.close)
      if (seed.length === 200) ema = mean(seed)
    } else ema = c.close * k + ema * (1 - k)
    if (!Number.isNaN(ema)) emaByDay.set(Math.floor(c.openTime / DAY), c.close > ema)
  }
}
const isBull = (t: number) => emaByDay.get(Math.floor(t / DAY) - 1) ?? null

const n = h1.length
const W = 24
const imp4 = new Array<number>(n).fill(NaN)
const flow10 = new Array<number>(n).fill(NaN)
const rangeHi = new Array<number>(n).fill(NaN)
const rangeLo = new Array<number>(n).fill(NaN)
const rangePct = new Array<number>(n).fill(NaN)
{
  const fwin: number[] = []
  for (let i = 0; i < n; i++) {
    if (i >= 4) imp4[i] = Math.log(h1[i].close / h1[i - 4].close) * 1e4
    const f = h1[i].volume > 0 ? h1[i].takerBuyBase / h1[i].volume : 0.5
    fwin.push(f)
    if (fwin.length > 10) fwin.shift()
    flow10[i] = mean(fwin)
    if (i >= W) {
      let hi = -Infinity
      let lo = Infinity
      for (let j = i - W; j < i; j++) {
        hi = Math.max(hi, h1[j].high)
        lo = Math.min(lo, h1[j].low)
      }
      rangeHi[i] = hi
      rangeLo[i] = lo
      rangePct[i] = ((hi - lo) / h1[i].close) * 1e4
    }
  }
}
const startIdx = h1.findIndex((c) => c.openTime >= FROM)
const YEARS_SPAN = (TO - FROM) / (365.25 * DAY)
const sImp = imp4.filter((x, i) => Number.isFinite(x) && i >= startIdx).sort((a, b) => a - b)
const sRange = rangePct.filter((x, i) => Number.isFinite(x) && i >= startIdx).sort((a, b) => a - b)
const P85 = pct(sImp, 0.85)
const Q20 = pct(sRange, 0.2)

const sigA = (i: number) => imp4[i] >= P85 && flow10[i] > 0.5 && isBull(h1[i].openTime) === true
const sigB = (i: number) => rangePct[i] <= Q20 && h1[i].close > rangeHi[i]
const SIGNALS: Array<[string, (i: number) => boolean]> = [
  ['A imp×flow×bull', sigA],
  ['B squeeze-brk q20', sigB],
  ['C union A∪B', (i) => sigA(i) || sigB(i)],
  ['D inter A∩B', (i) => sigA(i) && sigB(i)],
]

interface SimRes {
  netBps: number[]
  wr: number
  stops: number
  times: number
  filled?: number
  missed?: number
  missedFwd?: number[]
}
/** entrée taker à open(i+1) */
function simTaker(sig: (i: number) => boolean, stopBps: number, ts: number): SimRes {
  const netBps: number[] = []
  let stops = 0
  let times = 0
  let i = Math.max(startIdx, 28)
  while (i < n - ts - 2) {
    if (!sig(i)) {
      i++
      continue
    }
    const entry = h1[i + 1].open * (1 + TAKER / 2e4)
    const stop = entry * (1 + stopBps / 1e4)
    let exitBps = NaN
    let j = i + 1
    for (; j <= i + ts; j++) {
      if (h1[j].low <= stop) {
        exitBps = Math.log(stop / entry) * 1e4
        stops++
        break
      }
    }
    if (Number.isNaN(exitBps)) {
      exitBps = Math.log(h1[i + ts].close / entry) * 1e4
      times++
      j = i + ts
    }
    netBps.push(exitBps - TAKER)
    i = j + 1
  }
  return { netBps, wr: netBps.filter((x) => x > 0).length / netBps.length, stops, times }
}
/** entrée maker : limite à open(i+1)×(1−δ), valable 6 barres ; non rempli = signal abandonné */
function simMaker(sig: (i: number) => boolean, deltaBps: number, stopBps: number, ts: number): SimRes {
  const netBps: number[] = []
  const missedFwd: number[] = []
  let stops = 0
  let times = 0
  let filled = 0
  let missed = 0
  let i = Math.max(startIdx, 28)
  while (i < n - ts - 8 - 2) {
    if (!sig(i)) {
      i++
      continue
    }
    const limit = h1[i + 1].open * (1 - deltaBps / 1e4)
    // cherche le fill dans les 6 barres suivantes (fill si low ≤ limite)
    let fillBar = -1
    for (let j = i + 1; j <= i + 6; j++) {
      if (h1[j].low <= limit) {
        fillBar = j
        break
      }
    }
    if (fillBar < 0) {
      missed++
      // perf fantôme du signal abandonné (close i → close i+ts) pour le biais de sélection
      missedFwd.push(Math.log(h1[i + ts].close / h1[i].close) * 1e4)
      i = i + 1
      continue
    }
    filled++
    const entry = limit // maker : pas de slippage
    const stop = entry * (1 + stopBps / 1e4)
    let exitBps = NaN
    let j = fillBar
    // la barre de fill peut aussi toucher le stop (pessimiste : stop si low ≤ stop)
    for (; j <= fillBar + ts; j++) {
      if (j >= n) break
      if (h1[j].low <= stop) {
        exitBps = Math.log(stop / entry) * 1e4
        stops++
        break
      }
    }
    if (Number.isNaN(exitBps)) {
      const end = Math.min(fillBar + ts, n - 1)
      exitBps = Math.log(h1[end].close / entry) * 1e4
      times++
      j = end
    }
    netBps.push(exitBps - (MAKER + TAKER)) // entrée maker 8 + sortie taker 15
    i = j + 1
  }
  return { netBps, wr: netBps.filter((x) => x > 0).length / netBps.length, stops, times, filled, missed, missedFwd }
}

console.log(`H5' duel des porteurs 48-72h — ${SYMBOL} 1h (p85=${P85.toFixed(0)} bps, q20 range=${Q20.toFixed(0)} bps)`)
console.log('\n══ ENTRÉE TAKER (open+1, stop -300, time-stop) ══')
console.log('signal'.padEnd(20) + 'tS'.padStart(4) + 'n'.padStart(6) + '/an'.padStart(5) + 'WR%'.padStart(6) + 'E[net] [t]'.padStart(17) + 'st/ti'.padStart(9) + 'net/an bps'.padStart(11))
for (const [label, sig] of SIGNALS) {
  for (const ts of [48, 72]) {
    const r = simTaker(sig, -300, ts)
    if (r.netBps.length < 15) {
      console.log(label.padEnd(20) + String(ts).padStart(4) + String(r.netBps.length).padStart(6) + '  (trop peu)')
      continue
    }
    console.log(
      label.padEnd(20) + String(ts).padStart(4) + String(r.netBps.length).padStart(6) + (r.netBps.length / YEARS_SPAN).toFixed(0).padStart(5) +
        (r.wr * 100).toFixed(0).padStart(5) + '%' + `${fb(mean(r.netBps))} [${(tstat(r.netBps) || 0).toFixed(1).padStart(4)}]`.padStart(17) +
        `${r.stops}/${r.times}`.padStart(9) + fb((mean(r.netBps) * r.netBps.length) / YEARS_SPAN, 11),
    )
  }
}

console.log('\n══ ENTRÉE MAKER (limite open+1 − δ, valable 6h ; stop -300 ; time 48h) ══')
console.log('signal'.padEnd(20) + 'δ'.padStart(4) + 'n'.padStart(6) + 'fill%'.padStart(7) + 'WR%'.padStart(6) + 'E[net] [t]'.padStart(17) + 'E[fantôme]'.padStart(11) + 'net/an bps'.padStart(11))
for (const [label, sig] of SIGNALS.slice(0, 3)) {
  for (const delta of [10, 30]) {
    const r = simMaker(sig, delta, -300, 48)
    if (r.netBps.length < 15) {
      console.log(label.padEnd(20) + String(delta).padStart(4) + String(r.netBps.length).padStart(6) + '  (trop peu)')
      continue
    }
    console.log(
      label.padEnd(20) + String(delta).padStart(4) + String(r.netBps.length).padStart(6) +
        ((r.filled! / (r.filled! + r.missed!)) * 100).toFixed(0).padStart(6) + '%' +
        (r.wr * 100).toFixed(0).padStart(5) + '%' + `${fb(mean(r.netBps))} [${(tstat(r.netBps) || 0).toFixed(1).padStart(4)}]`.padStart(17) +
        fb(mean(r.missedFwd!), 11) + fb((mean(r.netBps) * r.netBps.length) / YEARS_SPAN, 11),
    )
  }
}

// stabilité par ère du meilleur bras taker (à lire, pas à optimiser)
console.log('\n══ STABILITÉ PAR ANNÉE (A et B, taker, stop -300, time 48h — E[net] bps (n)) ══')
for (const [label, sig] of SIGNALS.slice(0, 2)) {
  const r = simTaker(sig, -300, 48)
  // ré-attribue chaque trade à son année via une seconde passe
  const byYear = new Map<number, number[]>()
  let i = Math.max(startIdx, 28)
  let k = 0
  while (i < n - 50 && k < r.netBps.length) {
    if (!sig(i)) {
      i++
      continue
    }
    const y = new Date(h1[i].openTime).getUTCFullYear()
    if (!byYear.has(y)) byYear.set(y, [])
    byYear.get(y)!.push(r.netBps[k])
    // ré-simule la durée pour avancer pareil
    const entry = h1[i + 1].open * (1 + TAKER / 2e4)
    const stop = entry * (1 - 300 / 1e4)
    let j = i + 1
    for (; j <= i + 48; j++) if (h1[j].low <= stop) break
    i = Math.min(j, i + 48) + 1
    k++
  }
  let row = label.padEnd(20)
  for (const y of [...byYear.keys()].sort()) {
    const v = byYear.get(y)!
    row += ` ${y}:${fb(mean(v), 6)}(${v.length})`
  }
  console.log(row)
}
process.exit(0)
