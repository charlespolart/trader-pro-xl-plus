/**
 * Vague 2 — verdict du survivant : WF du breakout Donchian 55 × vol>1,5×SMA20,
 * long-only bull, entrée open+1 taker 15 bps, stop -300, time-stop 126 barres
 * 4h (~21 j) — config FIGÉE issue du plateau D19/D20 (aucun re-fit ici).
 * Mêmes 6 fenêtres que wfswing (2019-01→2026-01, isRatio 0,6) pour comparaison
 * directe avec btc-swing ; la dernière fenêtre couvre 2025 = l'OOS famille
 * (dépense protocolaire au moment de la promotion). Null apparié par fenêtre
 * (mêmes n/durées, starts aléatoires bull, 200 tirages) → percentile.
 *   bun apps/backend/src/research/dayswing/donchwf.ts [--symbol=BTCUSDT]
 */
import { createDb } from '@tpx/db'
import { CandleStore } from '@tpx/data'
import { walkForwardWindows } from '@tpx/core'

const arg = (name: string, dflt: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? dflt
const SYMBOL = arg('symbol', 'BTCUSDT')
const START = Date.parse('2019-01-01T00:00:00Z')
const END = Date.parse('2026-01-01T00:00:00Z')
const DAY = 86_400_000
const TAKER = 15
const TS = 126
const STOP = -300

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN)
const fb = (x: number, w = 7) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(1) : '—').padStart(w)

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5438/tpx')
const store = new CandleStore(db)
const cs = await store.getCandles('spot', SYMBOL, '4h', START - 90 * DAY, END)
const d1 = await store.getCandles('spot', SYMBOL, '1d', START - 320 * DAY, END)
const n = cs.length
const close = cs.map((c) => c.close)
const high = cs.map((c) => c.high)
const low = cs.map((c) => c.low)
const vol = cs.map((c) => c.volume)

const emaByDay = new Map<number, boolean>()
{
  const k = 2 / 201
  let ema = NaN
  const seed: number[] = []
  for (const c of d1) {
    if (Number.isNaN(ema)) {
      seed.push(c.close)
      if (seed.length === 200) ema = seed.reduce((a, b) => a + b, 0) / 200
    } else ema = c.close * k + ema * (1 - k)
    if (!Number.isNaN(ema)) emaByDay.set(Math.floor(c.openTime / DAY), c.close > ema)
  }
}
const bullAt = (i: number) => emaByDay.get(Math.floor(cs[i].openTime / DAY) - 1) === true

const don55 = (() => {
  const out = new Array<number>(n).fill(NaN)
  const dq: number[] = []
  for (let i = 0; i < n; i++) {
    if (i >= 1) {
      while (dq.length && high[dq[dq.length - 1]] <= high[i - 1]) dq.pop()
      dq.push(i - 1)
      while (dq.length && dq[0] < i - 55) dq.shift()
      if (i >= 55) out[i] = high[dq[0]]
    }
  }
  return out
})()
const volSma20 = (() => {
  const out = new Array<number>(n).fill(NaN)
  let s = 0
  for (let i = 0; i < n; i++) {
    s += vol[i]
    if (i >= 20) s -= vol[i - 20]
    if (i >= 19) out[i] = s / 20
  }
  return out
})()
const sig = (i: number) => close[i] > don55[i] && vol[i] > 1.5 * volSma20[i] && bullAt(i)

/** sim séquentielle sur [a,b) : retourne ret composé (%) + trades (durées) */
function sim(a: number, b: number): { retPct: number; trades: Array<{ durBars: number }> } {
  let i = cs.findIndex((c) => c.openTime >= a)
  const endIdx = (() => {
    const k = cs.findIndex((c) => c.openTime >= b)
    return k < 0 ? n : k
  })()
  let equity = 1
  const trades: Array<{ durBars: number }> = []
  while (i < endIdx - 2) {
    if (!sig(i)) {
      i++
      continue
    }
    const entry = cs[i + 1].open * (1 + TAKER / 2e4)
    const stop = entry * (1 + STOP / 1e4)
    let exitPx = NaN
    let j = i + 1
    for (; j <= Math.min(i + TS, endIdx - 1); j++) {
      if (low[j] <= stop) {
        exitPx = stop
        break
      }
    }
    if (Number.isNaN(exitPx)) {
      j = Math.min(i + TS, endIdx - 1)
      exitPx = close[j]
    }
    equity *= (exitPx / entry) * (1 - TAKER / 1e4)
    trades.push({ durBars: j - i })
    i = j + 1
  }
  return { retPct: (equity - 1) * 100, trades }
}

const windows = walkForwardWindows(START, END, { windows: 6, isRatio: 0.6, anchored: false })
const SWING_REF = [98.2, 9.6, 26.7, 36.3, 6.8, -1.5] // wfswing D16, mêmes fenêtres
console.log(`DONCH-WF — ${SYMBOL} 4h, D55×vol1,5 FIGÉ, stop -300, time 126b · 6 fenêtres 2019→2026-01\n`)
console.log('fenêtre'.padEnd(26) + 'Donchian'.padStart(10) + '  tr' + 'btc-swing (réf)'.padStart(17))
let comp = 1
let pos = 0
const perWin: Array<{ a: number; b: number; trades: Array<{ durBars: number }>; ret: number }> = []
windows.forEach((w, k) => {
  const r = sim(w.oosStart, w.oosEnd)
  comp *= 1 + r.retPct / 100
  if (r.retPct > 0) pos++
  perWin.push({ a: w.oosStart, b: w.oosEnd, trades: r.trades, ret: r.retPct })
  console.log(
    `${new Date(w.oosStart).toISOString().slice(0, 10)}→${new Date(w.oosEnd).toISOString().slice(0, 10)}`.padEnd(26) +
      fb(r.retPct, 9) + '%' + String(r.trades.length).padStart(4) + fb(SWING_REF[k], 15) + '%',
  )
})
console.log(`\nOOS composé : ${fb((comp - 1) * 100)}% (${pos}/6 fenêtres +) · btc-swing réf : +294,4 % (5/6)`)

// null apparié : mêmes nombres/durées, starts aléatoires bull par fenêtre
{
  let s = 0xd0c4
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
  const nulls: number[] = []
  for (let d = 0; d < 200; d++) {
    let c2 = 1
    for (const w of perWin) {
      const idxs: number[] = []
      const a = cs.findIndex((c) => c.openTime >= w.a)
      const b = cs.findIndex((c) => c.openTime >= w.b)
      for (let i = Math.max(a, 0); i < (b < 0 ? n : b) - 2; i++) if (bullAt(i)) idxs.push(i)
      let wr2 = 1
      for (const t of w.trades) {
        if (!idxs.length) continue
        const at = idxs[Math.floor(rand() * idxs.length)]
        const end = Math.min(at + t.durBars, n - 1)
        wr2 *= (close[end] / close[at]) * (1 - 0.003)
      }
      c2 *= wr2
    }
    nulls.push((c2 - 1) * 100)
  }
  nulls.sort((a, b) => a - b)
  const real = (comp - 1) * 100
  const below = nulls.filter((x) => x < real).length
  console.log(`null apparié : méd ${fb(nulls[100])}% · p95 ${fb(nulls[189])}% · percentile du réel = ${((below / 200) * 100).toFixed(1)} (barre ≥ 95)`)
}
process.exit(0)
