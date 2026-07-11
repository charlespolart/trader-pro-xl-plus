/**
 * Vague 2 — deep-dive du survivant : DONCHIAN BREAKOUT long-only en bull.
 * (1) PLATEAU : longueur {20,55,100} × filtre volume {aucun, >1,2, >1,5, >2,0 ×SMA20}
 *     × TF {4h, 1d} — médiane du voisinage, jamais le meilleur point ;
 * (2) PREMIER PASSAGE aux coûts réels (entrée open+1 taker 15 bps, un trade à
 *     la fois) × 3 exits : time-stop 42b/126b (4h) ou 7b/21b (1d) + stop -300 ;
 *     trailing turtle (close < plus-bas Donchian 10/20) ; recross EMA20 ;
 * (3) OVERLAP vs btc-swing : % des entrées Donchian déjà couvertes par le
 *     signal swing (ER+flow+EMA50) le même jour — un edge NOUVEAU doit
 *     apporter des trades que la prod n'a pas.
 *   bun apps/backend/src/research/dayswing/donch.ts [--symbol=BTCUSDT] [--itv=4h]
 */
import { createDb } from '@tpx/db'
import { CandleStore } from '@tpx/data'
import type { Interval } from '@tpx/shared'

const arg = (name: string, dflt: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? dflt
const SYMBOL = arg('symbol', 'BTCUSDT')
const ITV = arg('itv', '4h') as Interval
const FROM = Date.parse('2018-01-01T00:00:00Z')
const TO = Date.parse('2025-01-01T00:00:00Z')
const DAY = 86_400_000
const TAKER = 15
const IS_1D = ITV === '1d'
const TS_SHORT = IS_1D ? 7 : 42
const TS_LONG = IS_1D ? 21 : 126

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN)
const sd = (v: number[]) => {
  if (v.length < 2) return NaN
  const m = mean(v)
  return Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / (v.length - 1))
}
const tstat = (v: number[]) => (v.length < 2 ? NaN : mean(v) / (sd(v) / Math.sqrt(v.length)))
const fb = (x: number, w = 7) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(0) : '—').padStart(w)
const pct = (s: number[], p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const store = new CandleStore(db)
const cs = await store.getCandles('spot', SYMBOL, ITV, FROM - 90 * DAY, TO)
const d1 = await store.getCandles('spot', SYMBOL, '1d', FROM - 320 * DAY, TO)
const n = cs.length
const startIdx = cs.findIndex((c) => c.openTime >= FROM)
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

function donchHi(p: number): number[] {
  const out = new Array<number>(n).fill(NaN)
  const dq: number[] = []
  for (let i = 0; i < n; i++) {
    if (i >= 1) {
      while (dq.length && high[dq[dq.length - 1]] <= high[i - 1]) dq.pop()
      dq.push(i - 1)
      while (dq.length && dq[0] < i - p) dq.shift()
      if (i >= p) out[i] = high[dq[0]]
    }
  }
  return out
}
function donchLo(p: number): number[] {
  const out = new Array<number>(n).fill(NaN)
  const dq: number[] = []
  for (let i = 0; i < n; i++) {
    if (i >= 1) {
      while (dq.length && low[dq[dq.length - 1]] >= low[i - 1]) dq.pop()
      dq.push(i - 1)
      while (dq.length && dq[0] < i - p) dq.shift()
      if (i >= p) out[i] = low[dq[0]]
    }
  }
  return out
}
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
const ema20 = (() => {
  const out = new Array<number>(n).fill(NaN)
  const k = 2 / 21
  let e = NaN
  let s = 0
  for (let i = 0; i < n; i++) {
    if (i < 20) {
      s += close[i]
      if (i === 19) {
        e = s / 20
        out[i] = e
      }
    } else {
      e = close[i] * k + e * (1 - k)
      out[i] = e
    }
  }
  return out
})()
const dons = new Map<number, number[]>()
for (const p of [10, 20, 55, 100]) dons.set(p, donchHi(p))
const donLo10 = donchLo(10)
const donLo20 = donchLo(20)

// signal btc-swing approx (overlap) : bull × ER20≥0,35 × flow10>0,5 × close>EMA50 — sur ce TF
const swingSig = (() => {
  const out = new Array<boolean>(n).fill(false)
  const ema50 = (() => {
    const o = new Array<number>(n).fill(NaN)
    const k = 2 / 51
    let e = NaN
    let s = 0
    for (let i = 0; i < n; i++) {
      if (i < 50) {
        s += close[i]
        if (i === 49) {
          e = s / 50
          o[i] = e
        }
      } else {
        e = close[i] * k + e * (1 - k)
        o[i] = e
      }
    }
    return o
  })()
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

// ---------- 1. plateau (event study, fwd médian-horizon, dé-chevauché) ----------
const H = TS_SHORT
const baseline: number[] = []
for (let i = startIdx; i < n - TS_LONG - 2; i++) if (bullAt(i)) baseline.push(Math.log(close[i + H] / close[i]) * 1e4)
console.log(`DONCH deep-dive — ${SYMBOL} ${ITV} 2018→2025-01 · baseline bull fwd${H}b = ${fb(mean(baseline))} bps\n`)
console.log('══ 1. PLATEAU longueur × filtre volume — E[fwd' + H + 'b] (n) ══')
console.log('len'.padEnd(6) + ['sans', '>1,2×', '>1,5×', '>2,0×'].map((s) => s.padStart(16)).join(''))
const plateau: number[] = []
for (const len of [20, 55, 100]) {
  const dh = dons.get(len)!
  let row = String(len).padEnd(6)
  for (const vt of [0, 1.2, 1.5, 2.0]) {
    const evs: number[] = []
    let nextOk = 0
    for (let i = Math.max(startIdx, 101); i < n - TS_LONG - 2; i++) {
      if (i < nextOk) continue
      if (!(close[i] > dh[i] && bullAt(i))) continue
      if (vt > 0 && !(vol[i] > vt * volSma20[i])) continue
      evs.push(i)
      nextOk = i + H
    }
    const v = evs.map((i) => Math.log(close[i + H] / close[i]) * 1e4)
    if (evs.length >= 15) plateau.push(mean(v))
    row += `${fb(mean(v), 8)} (${String(evs.length).padStart(3)})`.padStart(16)
  }
  console.log(row)
}
const sortedPlateau = [...plateau].sort((a, b) => a - b)
console.log(`plateau : min ${fb(sortedPlateau[0])} · médiane ${fb(pct(sortedPlateau, 0.5))} · max ${fb(sortedPlateau[sortedPlateau.length - 1])} · baseline ${fb(mean(baseline))}`)

// ---------- 2. premier passage (D55 × vol>1,5 — la cellule candidate) ----------
console.log('\n══ 2. PREMIER PASSAGE (D55 × vol>1,5, entrée open+1 taker, coûts réels) ══')
interface XRes { net: number[]; wr: number; stops: number; hold: number }
function runExit(exitKind: 'time-court' | 'time-long' | 'turtle' | 'recross', volTh: number, len = 55): XRes {
  const dh = dons.get(len)!
  const net: number[] = []
  let stops = 0
  let holdSum = 0
  let i = Math.max(startIdx, 101)
  const ts = exitKind === 'time-court' ? TS_SHORT : TS_LONG
  while (i < n - TS_LONG - 2) {
    const sig = close[i] > dh[i] && bullAt(i) && (volTh === 0 || vol[i] > volTh * volSma20[i])
    if (!sig) {
      i++
      continue
    }
    const entry = cs[i + 1].open * (1 + TAKER / 2e4)
    const stop = entry * (1 - 300 / 1e4)
    let exitBps = NaN
    let j = i + 1
    for (; j <= Math.min(i + ts, n - 2); j++) {
      if (low[j] <= stop) {
        exitBps = Math.log(stop / entry) * 1e4
        stops++
        break
      }
      if (exitKind === 'turtle' && close[j] < (IS_1D ? donLo10 : donLo20)[j]) {
        exitBps = Math.log(close[j] / entry) * 1e4
        break
      }
      if (exitKind === 'recross' && close[j] < ema20[j]) {
        exitBps = Math.log(close[j] / entry) * 1e4
        break
      }
    }
    if (Number.isNaN(exitBps)) {
      const end = Math.min(i + ts, n - 2)
      exitBps = Math.log(close[end] / entry) * 1e4
      j = end
    }
    holdSum += j - i
    net.push(exitBps - TAKER)
    i = j + 1
  }
  return { net, wr: net.filter((x) => x > 0).length / net.length, stops, hold: holdSum / net.length }
}
const YEARS_SPAN = (TO - FROM) / (365.25 * DAY)
console.log('exit'.padEnd(14) + 'vol'.padStart(5) + 'n'.padStart(5) + '/an'.padStart(5) + 'WR%'.padStart(6) + 'E[net] [t]'.padStart(16) + 'stops'.padStart(7) + 'hold_b'.padStart(8) + 'net/an bps'.padStart(11))
for (const exitKind of ['time-court', 'time-long', 'turtle', 'recross'] as const) {
  for (const volTh of [0, 1.5]) {
    const r = runExit(exitKind, volTh)
    if (r.net.length < 10) continue
    console.log(
      exitKind.padEnd(14) + (volTh ? '1,5' : '—').padStart(5) + String(r.net.length).padStart(5) +
        (r.net.length / YEARS_SPAN).toFixed(0).padStart(5) + (r.wr * 100).toFixed(0).padStart(5) + '%' +
        `${fb(mean(r.net))} [${(tstat(r.net) || 0).toFixed(1).padStart(4)}]`.padStart(16) + String(r.stops).padStart(7) +
        r.hold.toFixed(0).padStart(8) + fb((mean(r.net) * r.net.length) / YEARS_SPAN, 11),
    )
  }
}

// ---------- 3. overlap vs btc-swing ----------
console.log('\n══ 3. OVERLAP vs signal btc-swing (même barre ± 6 barres) ══')
{
  const dh = dons.get(55)!
  const evs: number[] = []
  let nextOk = 0
  for (let i = Math.max(startIdx, 101); i < n - TS_LONG - 2; i++) {
    if (i < nextOk) continue
    if (!(close[i] > dh[i] && bullAt(i) && vol[i] > 1.5 * volSma20[i])) continue
    evs.push(i)
    nextOk = i + H
  }
  let overlap = 0
  for (const i of evs) {
    let hit = false
    for (let j = Math.max(0, i - 6); j <= Math.min(n - 1, i + 6) && !hit; j++) if (swingSig[j]) hit = true
    if (hit) overlap++
  }
  console.log(`D55×vol : ${evs.length} events · ${overlap} (${((overlap / evs.length) * 100).toFixed(0)} %) déjà couverts par un signal swing ±6 barres → ${evs.length - overlap} vraiment NOUVEAUX`)
}
process.exit(0)
