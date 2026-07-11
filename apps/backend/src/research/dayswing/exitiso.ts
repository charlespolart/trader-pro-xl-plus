/**
 * Vague 2 — isolation du facteur : le gain du Donchian vient-il de l'ENTRÉE
 * (cassure D55×vol vs ER/flow/EMA50) ou de l'EXIT (time-stop 126b ~21 j vs
 * recross EMA50 ~5 j) ? Grille 3 entrées × 2 exits, WF 6 fenêtres identiques,
 * sim séquentielle taker/stop -300, BTC 4h.
 *   bun apps/backend/src/research/dayswing/exitiso.ts [--symbol=BTCUSDT]
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
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN)
const fb = (x: number, w = 8) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(1) : '—').padStart(w)

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
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

function emaArr(p: number): number[] {
  const out = new Array<number>(n).fill(NaN)
  const k = 2 / (p + 1)
  let e = NaN
  let s = 0
  for (let i = 0; i < n; i++) {
    if (i < p) {
      s += close[i]
      if (i === p - 1) {
        e = s / p
        out[i] = e
      }
    } else {
      e = close[i] * k + e * (1 - k)
      out[i] = e
    }
  }
  return out
}
const ema50 = emaArr(50)
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
const swingSig = (() => {
  const out = new Array<boolean>(n).fill(false)
  const fwin: number[] = []
  for (let i = 21; i < n; i++) {
    const f = cs[i].volume > 0 ? cs[i].takerBuyBase / cs[i].volume : 0.5
    fwin.push(f)
    if (fwin.length > 10) fwin.shift()
    const net = Math.abs(close[i] - close[i - 20])
    let sum = 0
    for (let j = i - 19; j <= i; j++) sum += Math.abs(close[j] - close[j - 1])
    const er = sum === 0 ? 0 : net / sum
    out[i] = bullAt(i) && er >= 0.35 && mean(fwin) > 0.5 && close[i] > ema50[i]
  }
  return out
})()
const donSig = (i: number) => close[i] > don55[i] && vol[i] > 1.5 * volSma20[i] && bullAt(i)

type Entry = 'swing' | 'donch' | 'union'
type Exit = 'recross' | 'time126'
function sim(a: number, b: number, entry: Entry, exit: Exit): { retPct: number; nTr: number } {
  let i = cs.findIndex((c) => c.openTime >= a)
  const endIdx = (() => {
    const k = cs.findIndex((c) => c.openTime >= b)
    return k < 0 ? n : k
  })()
  let equity = 1
  let nTr = 0
  while (i < endIdx - 2) {
    const s = entry === 'swing' ? swingSig[i] : entry === 'donch' ? donSig(i) : swingSig[i] || donSig(i)
    if (!s) {
      i++
      continue
    }
    const entryPx = cs[i + 1].open * (1 + TAKER / 2e4)
    const stop = entryPx * (1 - 300 / 1e4)
    let exitPx = NaN
    let j = i + 1
    for (; j <= Math.min(i + 126, endIdx - 1); j++) {
      if (low[j] <= stop) {
        exitPx = stop
        break
      }
      if (exit === 'recross' && close[j] < ema50[j]) {
        exitPx = close[j]
        break
      }
    }
    if (Number.isNaN(exitPx)) {
      j = Math.min(i + 126, endIdx - 1)
      exitPx = close[j]
    }
    equity *= (exitPx / entryPx) * (1 - TAKER / 1e4)
    nTr++
    i = j + 1
  }
  return { retPct: (equity - 1) * 100, nTr }
}

const windows = walkForwardWindows(START, END, { windows: 6, isRatio: 0.6, anchored: false })
console.log(`EXIT-ISO — ${SYMBOL} 4h, 3 entrées × 2 exits, WF 6 fenêtres (stop -300 partout)\n`)
console.log('config'.padEnd(24) + 'composé'.padStart(10) + 'fen+'.padStart(6) + 'tr/an'.padStart(7) + '   par fenêtre')
for (const entry of ['swing', 'donch', 'union'] as Entry[]) {
  for (const exit of ['recross', 'time126'] as Exit[]) {
    let comp = 1
    let pos = 0
    let tr = 0
    const rets: number[] = []
    for (const w of windows) {
      const r = sim(w.oosStart, w.oosEnd, entry, exit)
      comp *= 1 + r.retPct / 100
      if (r.retPct > 0) pos++
      tr += r.nTr
      rets.push(r.retPct)
    }
    console.log(
      `${entry} × ${exit}`.padEnd(24) + fb((comp - 1) * 100, 9) + '%' + `${pos}/6`.padStart(6) +
        (tr / 5.6).toFixed(0).padStart(7) + '   ' + rets.map((r) => fb(r, 7)).join(''),
    )
  }
}
process.exit(0)
