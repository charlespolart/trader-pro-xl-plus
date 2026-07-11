/**
 * Phase 1 — H3 suite : ingénierie d'exit par premier passage. Pour les events
 * impulsion(p85|p90)×flow×bull : simulation séquentielle honnête (entrée à
 * l'OPEN de la barre suivante + slippage, un trade à la fois) d'une grille
 * TP × stop × time-stop. Intrabar pessimiste : si TP et stop touchés dans la
 * même barre 1h → stop d'abord. Coûts par jambe : taker 10 bps + slip 5 ;
 * TP posé en limit maker 8 bps (rempli si high ≥ TP, convention limitFillRatio
 * ignorée = optimiste sur le partiel, noté). Sortie temps = taker.
 *
 * Verdict attendu : existe-t-il un PLATEAU de cellules avec expectancy nette
 * ≥ +15 bps/trade ? Sinon H3 meurt ici.
 *
 *   bun apps/backend/src/research/dayswing/h3exits.ts [--th=p85] [--from=2019-01-01] [--to=2025-01-01]
 */
import { createDb } from '@tpx/db'
import { CandleStore } from '@tpx/data'

const arg = (name: string, dflt: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? dflt
const FROM = Date.parse(arg('from', '2019-01-01') + 'T00:00:00Z')
const TO = Date.parse(arg('to', '2025-01-01') + 'T00:00:00Z')
const THP = arg('th', 'p85') === 'p90' ? 0.9 : 0.85
const DAY = 86_400_000

// coûts par jambe (bps)
const TAKER = 10 + 5 // taker + slip
const MAKER = 8 // limit posée, pas de slip

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
const h1 = await store.getCandles('spot', 'BTCUSDT', '1h', FROM - 30 * DAY, TO)
const d1 = await store.getCandles('spot', 'BTCUSDT', '1d', FROM - 320 * DAY, TO)

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
const imp4 = new Array<number>(n).fill(NaN)
const flow10 = new Array<number>(n).fill(NaN)
const fwin: number[] = []
for (let i = 1; i < n; i++) {
  if (i >= 4) imp4[i] = Math.log(h1[i].close / h1[i - 4].close) * 1e4
  const f = h1[i].volume > 0 ? h1[i].takerBuyBase / h1[i].volume : 0.5
  fwin.push(f)
  if (fwin.length > 10) fwin.shift()
  flow10[i] = mean(fwin)
}
const startIdx = h1.findIndex((c) => c.openTime >= FROM)
const sorted = imp4.filter((x, i) => Number.isFinite(x) && i >= startIdx).sort((a, b) => a - b)
const TH = pct(sorted, THP)
const isSignal = (i: number) => imp4[i] >= TH && flow10[i] > 0.5 && isBull(h1[i].openTime) === true

interface Res {
  netBps: number[]
  wr: number
  tpHits: number
  stopHits: number
  timeouts: number
  avgHold: number
}
/** simulation séquentielle : un trade à la fois, entrée open(i+1) */
function run(tpBps: number, stopBps: number, timeStop: number): Res {
  const netBps: number[] = []
  let tpHits = 0
  let stopHits = 0
  let timeouts = 0
  let holdSum = 0
  let i = Math.max(startIdx, 28)
  while (i < n - timeStop - 2) {
    if (!isSignal(i)) {
      i++
      continue
    }
    const entry = h1[i + 1].open * (1 + TAKER / 2e4) // entrée taker à l'open suivant (demi-slip inclus dans TAKER)
    const tp = entry * (1 + tpBps / 1e4)
    const stop = entry * (1 + stopBps / 1e4)
    let exitBps = NaN
    let exitCost = TAKER
    let j = i + 1
    for (; j <= i + timeStop; j++) {
      const c = h1[j]
      // pessimiste : le stop d'abord si les deux sont touchés dans la barre
      if (c.low <= stop) {
        exitBps = Math.log(stop / entry) * 1e4
        exitCost = TAKER
        stopHits++
        break
      }
      if (Number.isFinite(tpBps) && c.high >= tp) {
        exitBps = Math.log(tp / entry) * 1e4
        exitCost = MAKER
        tpHits++
        break
      }
    }
    if (Number.isNaN(exitBps)) {
      exitBps = Math.log(h1[i + timeStop].close / entry) * 1e4
      exitCost = TAKER
      timeouts++
      j = i + timeStop
    }
    holdSum += j - i
    // coût d'entrée déjà dans le prix d'entrée ; on retire la jambe de sortie
    netBps.push(exitBps - exitCost)
    i = j + 1 // un trade à la fois
  }
  const wins = netBps.filter((x) => x > 0).length
  return { netBps, wr: wins / netBps.length, tpHits, stopHits, timeouts, avgHold: holdSum / netBps.length }
}

console.log(`H3 exits (premier passage) — BTCUSDT 1h, seuil ${arg('th', 'p85')}=${TH.toFixed(0)} bps, coûts entrée taker ${TAKER} + sortie TP maker ${MAKER}/stop-time taker ${TAKER}`)
console.log(
  'TP'.padStart(6) + 'stop'.padStart(7) + 'tStop'.padStart(7) + 'n'.padStart(6) + '/an'.padStart(5) +
    'WR%'.padStart(6) + 'E[net] [t]'.padStart(16) + 'TP/stop/time'.padStart(15) + 'hold_h'.padStart(8) + 'net/an bps'.padStart(11),
)
const YEARS_SPAN = (TO - FROM) / (365.25 * DAY)
const results: Array<{ tp: number; stop: number; ts: number; e: number; t: number; wr: number; n: number }> = []
for (const tp of [40, 60, 80, 120, Infinity]) {
  for (const stop of [-80, -120, -200, -300]) {
    for (const ts of [24, 48]) {
      const r = run(tp, stop, ts)
      const e = mean(r.netBps)
      const t = tstat(r.netBps)
      results.push({ tp, stop, ts, e, t, wr: r.wr, n: r.netBps.length })
      console.log(
        (Number.isFinite(tp) ? '+' + tp : '∞').padStart(6) + String(stop).padStart(7) + String(ts).padStart(7) +
          String(r.netBps.length).padStart(6) + (r.netBps.length / YEARS_SPAN).toFixed(0).padStart(5) +
          (r.wr * 100).toFixed(0).padStart(5) + '%' + `${fb(e)} [${(Number.isFinite(t) ? t.toFixed(1) : '—').padStart(4)}]`.padStart(16) +
          `${r.tpHits}/${r.stopHits}/${r.timeouts}`.padStart(15) + r.avgHold.toFixed(0).padStart(8) +
          fb((e * r.netBps.length) / YEARS_SPAN, 11),
      )
    }
  }
}

// plateau : médiane du voisinage (règle du LOG : jamais le meilleur point)
console.log('\nrésumé plateau (médiane des cellules par TP) :')
for (const tp of [40, 60, 80, 120, Infinity]) {
  const cells = results.filter((r) => r.tp === tp).map((r) => r.e).sort((a, b) => a - b)
  console.log(`TP ${Number.isFinite(tp) ? '+' + tp : '∞'} : médiane E[net] = ${fb(pct(cells, 0.5))} bps (min ${fb(cells[0])}, max ${fb(cells[cells.length - 1])})`)
}
process.exit(0)
