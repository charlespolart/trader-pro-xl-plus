/**
 * Phase 1 — H4b : compression→expansion au grain 15m — LE test de fréquence.
 * Dernière chance de l'intraday : au 15m, un range de compression fait
 * 60-120 bps → stop structurel VRAIMENT serré, TP 1,5-2R ≈ 100-250 bps
 * (ratio TP/coûts bien meilleur que H3-1h), densité potentielle ~1/jour.
 * Si ça meurt aussi → conclusion structurelle : aucune fréquence intraday ne
 * survit aux coûts spot OKX, la campagne pivote sur le swing 48h+.
 *
 * Même protocole que h4squeeze.ts (events dé-chevauchés, premier passage
 * pessimiste, entrée open+1 taker 15 bps, TP maker 8, stop/time taker 15),
 * fenêtres de range en barres 15m : 32 (8h) et 96 (24h).
 *
 *   bun apps/backend/src/research/dayswing/h4b15m.ts [--from=2019-01-01] [--to=2025-01-01]
 */
import { createDb } from '@tpx/db'
import { CandleStore } from '@tpx/data'

const arg = (name: string, dflt: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? dflt
const FROM = Date.parse(arg('from', '2019-01-01') + 'T00:00:00Z')
const TO = Date.parse(arg('to', '2025-01-01') + 'T00:00:00Z')
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
console.log('chargement 15m…')
const m15 = await store.getCandles('spot', 'BTCUSDT', '15m', FROM - 10 * DAY, TO)
const d1 = await store.getCandles('spot', 'BTCUSDT', '1d', FROM - 320 * DAY, TO)
console.log(`${m15.length} barres 15m`)

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

const n = m15.length
const startIdx = m15.findIndex((c) => c.openTime >= FROM)
const YEARS_SPAN = (TO - FROM) / (365.25 * DAY)

for (const W of [32, 96]) {
  // précalcul du range sur W barres
  const rangeHi = new Array<number>(n).fill(NaN)
  const rangeLo = new Array<number>(n).fill(NaN)
  const rangePct = new Array<number>(n).fill(NaN)
  {
    // deques monotones pour O(n)
    const hiQ: number[] = []
    const loQ: number[] = []
    for (let i = 0; i < n; i++) {
      // fenêtre [i-W, i)
      if (i >= 1) {
        while (hiQ.length && m15[hiQ[hiQ.length - 1]].high <= m15[i - 1].high) hiQ.pop()
        hiQ.push(i - 1)
        while (loQ.length && m15[loQ[loQ.length - 1]].low >= m15[i - 1].low) loQ.pop()
        loQ.push(i - 1)
        while (hiQ.length && hiQ[0] < i - W) hiQ.shift()
        while (loQ.length && loQ[0] < i - W) loQ.shift()
        if (i >= W) {
          rangeHi[i] = m15[hiQ[0]].high
          rangeLo[i] = m15[loQ[0]].low
          rangePct[i] = ((rangeHi[i] - rangeLo[i]) / m15[i].close) * 1e4
        }
      }
    }
  }
  const sortedRange = rangePct.filter((x, i) => Number.isFinite(x) && i >= startIdx).sort((a, b) => a - b)
  console.log(`\n════ fenêtre ${W} barres 15m (${W / 4}h) — ranges q10=${pct(sortedRange, 0.1).toFixed(0)} q20=${pct(sortedRange, 0.2).toFixed(0)} méd=${pct(sortedRange, 0.5).toFixed(0)} bps ════`)

  // dérive brute post-cassure (dé-chevauché 24 barres = 6h)
  console.log('qLow'.padEnd(6) + 'n'.padStart(6) + '/an'.padStart(6) + ['8', '16', '32', '96'].map((h) => `fwd${h}b [t]`.padStart(18)).join('') + '   (b = barres 15m)')
  for (const q of [0.1, 0.2]) {
    const th = pct(sortedRange, q)
    const evs: number[] = []
    let nextOk = 0
    for (let i = Math.max(startIdx, W + 1); i < n - 100; i++) {
      if (i < nextOk) continue
      if (!(rangePct[i] <= th && m15[i].close > rangeHi[i])) continue
      evs.push(i)
      nextOk = i + 24
    }
    let row = `q${(q * 100).toFixed(0)}`.padEnd(6) + String(evs.length).padStart(6) + (evs.length / YEARS_SPAN).toFixed(0).padStart(6)
    for (const h of [8, 16, 32, 96]) {
      const v = evs.map((i) => Math.log(m15[i + h].close / m15[i].close) * 1e4)
      row += `${fb(mean(v))} [${(Number.isFinite(tstat(v)) ? tstat(v).toFixed(1) : '—').padStart(4)}]`.padStart(18)
    }
    console.log(row)
  }

  // premier passage
  console.log('\nqLow'.padEnd(6) + 'k'.padStart(4) + 'tSb'.padStart(5) + 'n'.padStart(6) + '/an'.padStart(6) + 'WR%'.padStart(6) + 'E[net] [t]'.padStart(16) + 'TP/st/ti'.padStart(13) + 'stop_méd'.padStart(9) + 'net/an'.padStart(9))
  for (const q of [0.1, 0.2]) {
    const th = pct(sortedRange, q)
    for (const k of [1, 1.5, 2]) {
      for (const ts of [32, 96]) {
        const netBps: number[] = []
        const stopDists: number[] = []
        let tpH = 0
        let stH = 0
        let tiH = 0
        let i = Math.max(startIdx, W + 1)
        while (i < n - ts - 2) {
          const sig = rangePct[i] <= th && m15[i].close > rangeHi[i] && isBull(m15[i].openTime) === true
          if (!sig) {
            i++
            continue
          }
          const entry = m15[i + 1].open * (1 + TAKER / 2e4)
          const stop = rangeLo[i] * (1 - 5 / 1e4)
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
            const c = m15[j]
            if (c.low <= stop) {
              exitBps = Math.log(stop / entry) * 1e4
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
            exitBps = Math.log(m15[i + ts].close / entry) * 1e4
            tiH++
            j = i + ts
          }
          netBps.push(exitBps - exitCost)
          i = j + 1
        }
        if (netBps.length < 20) continue
        const wr = netBps.filter((x) => x > 0).length / netBps.length
        const sortedStops = [...stopDists].sort((a, b) => a - b)
        console.log(
          `q${(q * 100).toFixed(0)}`.padEnd(6) + String(k).padStart(4) + String(ts).padStart(5) +
            String(netBps.length).padStart(6) + (netBps.length / YEARS_SPAN).toFixed(0).padStart(6) +
            (wr * 100).toFixed(0).padStart(5) + '%' +
            `${fb(mean(netBps))} [${(Number.isFinite(tstat(netBps)) ? tstat(netBps).toFixed(1) : '—').padStart(4)}]`.padStart(16) +
            `${tpH}/${stH}/${tiH}`.padStart(13) + fb(pct(sortedStops, 0.5), 9) +
            fb((mean(netBps) * netBps.length) / YEARS_SPAN, 9),
        )
      }
    }
  }
}
process.exit(0)
