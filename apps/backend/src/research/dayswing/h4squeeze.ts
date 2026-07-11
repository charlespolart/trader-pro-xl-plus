/**
 * Phase 1 — H4 : compression → expansion, avec STOP STRUCTUREL.
 *
 * Différence décisive vs H3 (mort en D10) : ici l'invalidation est le bord du
 * range de compression — un stop potentiellement SERRÉ (50-120 bps) et
 * signifiant, pas un multiple d'ATR arbitraire sur un marché à bruit/edge 8:1.
 * La question n'est plus « y a-t-il dérive ? » mais « P(expansion continue |
 * compression + cassure + flux) paie-t-elle le stop structurel ? ».
 *
 * Événement : à la barre i (1h), (a) compression : rangePct(24h) dans le
 * quantile bas qLow de l'IS (fenêtre range/close) ; (b) cassure haussière :
 * close > max(high des 24 barres précédentes) ; (c) flow10 > 0.5 ; (d) bull.
 * Premier passage : stop = min(low des nRange barres du range) − buffer,
 * TP = k × hauteur du range (mesurée), time-stop.
 * Événements séquentiels (un trade à la fois). Coûts D10 : entrée taker 15,
 * TP maker 8, stop/time taker 15. Miroir bear/cassure basse en contrôle.
 *
 *   bun apps/backend/src/research/dayswing/h4squeeze.ts [--from=2019-01-01] [--to=2025-01-01] [--symbol=BTCUSDT]
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
const W = 24 // fenêtre du range
const flow10 = new Array<number>(n).fill(NaN)
const rangeHi = new Array<number>(n).fill(NaN) // max high des W barres [i-W, i)
const rangeLo = new Array<number>(n).fill(NaN)
const rangePct = new Array<number>(n).fill(NaN) // (hi-lo)/close en bps
{
  const fwin: number[] = []
  for (let i = 0; i < n; i++) {
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
const sortedRange = rangePct.filter((x, i) => Number.isFinite(x) && i >= startIdx).sort((a, b) => a - b)

console.log(`H4 squeeze — ${SYMBOL} 1h, ${arg('from', '2019-01-01')} → ${arg('to', '2025-01-01')}`)
console.log(`distribution range24h (bps) : q10=${pct(sortedRange, 0.1).toFixed(0)} q20=${pct(sortedRange, 0.2).toFixed(0)} q30=${pct(sortedRange, 0.3).toFixed(0)} méd=${pct(sortedRange, 0.5).toFixed(0)}\n`)

// ---------- event study brut d'abord (dérive post-cassure, sans exits) ----------
console.log('══ 1. DÉRIVE POST-CASSURE (dé-chevauché 24h, close→close, bps) ══')
console.log('qLow'.padEnd(6) + 'cond'.padEnd(24) + 'n'.padStart(5) + '/an'.padStart(5) + ['4h', '8h', '24h', '48h'].map((h) => `fwd${h} [t]`.padStart(18)).join(''))
const YEARS_SPAN = (TO - FROM) / (365.25 * DAY)
function study(qLow: number, needFlow: boolean, needBull: boolean, label: string) {
  const th = pct(sortedRange, qLow)
  const evs: number[] = []
  let nextOk = 0
  for (let i = Math.max(startIdx, W + 1); i < n - 49; i++) {
    if (i < nextOk) continue
    if (!(rangePct[i] <= th)) continue
    if (!(h1[i].close > rangeHi[i])) continue
    if (needFlow && !(flow10[i] > 0.5)) continue
    if (needBull && isBull(h1[i].openTime) !== true) continue
    evs.push(i)
    nextOk = i + 24
  }
  let row = `q${(qLow * 100).toFixed(0)}`.padEnd(6) + label.padEnd(24) + String(evs.length).padStart(5) + (evs.length / YEARS_SPAN).toFixed(0).padStart(5)
  for (const h of [4, 8, 24, 48]) {
    const v = evs.map((i) => Math.log(h1[i + h].close / h1[i].close) * 1e4)
    row += `${fb(mean(v))} [${(Number.isFinite(tstat(v)) ? tstat(v).toFixed(1) : '—').padStart(4)}]`.padStart(18)
  }
  console.log(row)
  return evs
}
for (const q of [0.1, 0.2, 0.3]) {
  study(q, false, false, 'cassure seule')
  study(q, true, false, '× flow')
  study(q, true, true, '× flow × bull')
}

// ---------- 2. premier passage avec stop structurel ----------
console.log('\n══ 2. PREMIER PASSAGE — stop = bas du range − 10 bps, TP = k×range (maker), time-stop ══')
console.log(
  'qLow'.padEnd(6) + 'k'.padStart(4) + 'tStop'.padStart(6) + 'n'.padStart(5) + '/an'.padStart(5) + 'WR%'.padStart(6) +
    'E[net] [t]'.padStart(16) + 'TP/st/ti'.padStart(12) + 'stop_méd'.padStart(9) + 'hold'.padStart(6) + 'net/an'.padStart(9),
)
for (const qLow of [0.2, 0.3]) {
  const th = pct(sortedRange, qLow)
  for (const k of [1, 1.5, 2, 3]) {
    for (const ts of [24, 48]) {
      const netBps: number[] = []
      const stopDists: number[] = []
      let tpH = 0
      let stH = 0
      let tiH = 0
      let holdSum = 0
      let i = Math.max(startIdx, W + 1)
      while (i < n - ts - 2) {
        const sig =
          rangePct[i] <= th && h1[i].close > rangeHi[i] && flow10[i] > 0.5 && isBull(h1[i].openTime) === true
        if (!sig) {
          i++
          continue
        }
        const entry = h1[i + 1].open * (1 + TAKER / 2e4)
        const stop = rangeLo[i] * (1 - 10 / 1e4)
        const height = rangeHi[i] - rangeLo[i]
        const tp = entry + k * height
        if (stop >= entry) {
          i++
          continue
        }
        stopDists.push(Math.log(entry / stop) * 1e4)
        let exitBps = NaN
        let exitCost = TAKER
        let j = i + 1
        for (; j <= i + ts; j++) {
          const c = h1[j]
          if (c.low <= stop) {
            exitBps = Math.log(stop / entry) * 1e4
            exitCost = TAKER
            stH++
            break
          }
          if (c.high >= tp) {
            exitBps = Math.log(tp / entry) * 1e4
            exitCost = MAKER
            tpH++
            break
          }
        }
        if (Number.isNaN(exitBps)) {
          exitBps = Math.log(h1[i + ts].close / entry) * 1e4
          tiH++
          j = i + ts
        }
        holdSum += j - i
        netBps.push(exitBps - exitCost)
        i = j + 1
      }
      if (netBps.length < 10) continue
      const wr = netBps.filter((x) => x > 0).length / netBps.length
      const sortedStops = [...stopDists].sort((a, b) => a - b)
      console.log(
        `q${(qLow * 100).toFixed(0)}`.padEnd(6) + String(k).padStart(4) + String(ts).padStart(6) +
          String(netBps.length).padStart(5) + (netBps.length / YEARS_SPAN).toFixed(0).padStart(5) +
          (wr * 100).toFixed(0).padStart(5) + '%' +
          `${fb(mean(netBps))} [${(Number.isFinite(tstat(netBps)) ? tstat(netBps).toFixed(1) : '—').padStart(4)}]`.padStart(16) +
          `${tpH}/${stH}/${tiH}`.padStart(12) + fb(pct(sortedStops, 0.5), 9) + (holdSum / netBps.length).toFixed(0).padStart(6) +
          fb((mean(netBps) * netBps.length) / YEARS_SPAN, 9),
      )
    }
  }
}

// ---------- 3. miroir (contrôle) : cassure basse en bear ----------
console.log('\n══ 3. MIROIR (cassure basse × flow<0.5 × bear, dérive brute) ══')
{
  const th = pct(sortedRange, 0.2)
  const evs: number[] = []
  let nextOk = 0
  for (let i = Math.max(startIdx, W + 1); i < n - 49; i++) {
    if (i < nextOk) continue
    if (!(rangePct[i] <= th)) continue
    if (!(h1[i].close < rangeLo[i])) continue
    if (!(flow10[i] < 0.5)) continue
    if (isBull(h1[i].openTime) !== false) continue
    evs.push(i)
    nextOk = i + 24
  }
  let row = `n=${evs.length}  `
  for (const h of [4, 8, 24, 48]) {
    const v = evs.map((i) => Math.log(h1[i + h].close / h1[i].close) * 1e4)
    row += `fwd${h}h ${fb(mean(v))} [${(Number.isFinite(tstat(v)) ? tstat(v).toFixed(1) : '—')}]  `
  }
  console.log(row)
}
process.exit(0)
