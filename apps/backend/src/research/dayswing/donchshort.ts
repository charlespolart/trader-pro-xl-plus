/**
 * Vague 3 — LE CÔTÉ SHORT (frontière jamais explorée : toute la campagne était
 * spot long-only). Miroir du survivant : cassure Donchian-55 BASSE × volume
 * >1,5×SMA20, gatée régime BEAR (veille < EMA200 1d), sur 4h.
 * (1) Event study : E[fwd] vs baseline bear (dérive négative attendue —
 *     un short gagne -fwd), stabilité par ère ;
 * (2) Premier passage SHORT en conditions futures : frais taker 5 bps + slip
 *     5 bps par côté, stop +min(2,5×ATR, 4 %), sortie recross EMA50 par le
 *     haut, time-stop 126b, ET FUNDING RÉEL par trade (table funding_rates,
 *     8h ; le short REÇOIT le funding quand il est positif — avant 2020-01 :
 *     0, noté). Prix spot ≈ perp (basis quelques bps, D14).
 *   bun apps/backend/src/research/dayswing/donchshort.ts
 */
import { createDb } from '@tpx/db'
import { CandleStore } from '@tpx/data'

const DAY = 86_400_000
const FROM = Date.parse('2018-01-01T00:00:00Z')
const TO = Date.parse('2025-01-01T00:00:00Z')
const SIDE_FUT = 0.001 // 5 bps taker + 5 slip, par côté (futures)

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN)
const sd = (v: number[]) => {
  if (v.length < 2) return NaN
  const m = mean(v)
  return Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / (v.length - 1))
}
const tstat = (v: number[]) => (v.length < 2 ? NaN : mean(v) / (sd(v) / Math.sqrt(v.length)))
const welch = (a: number[], b: number[]) =>
  (mean(a) - mean(b)) / Math.sqrt((sd(a) ** 2) / a.length + (sd(b) ** 2) / b.length)
const fb = (x: number, w = 7) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(0) : '—').padStart(w)
const ft = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '—').padStart(5)

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const store = new CandleStore(db)
const h4 = await store.getCandles('spot', 'BTCUSDT', '4h', FROM - 60 * DAY, TO)
const d1 = await store.getCandles('spot', 'BTCUSDT', '1d', FROM - 320 * DAY, TO)
const n = h4.length
const startIdx = h4.findIndex((c) => c.openTime >= FROM)
const close = h4.map((c) => c.close)
const high = h4.map((c) => c.high)
const low = h4.map((c) => c.low)
const open = h4.map((c) => c.open)
const vol = h4.map((c) => c.volume)

// funding réel (8h) → map timestamp arrondi 8h → rate ; couverture 2020-01+
import { sql } from 'drizzle-orm'
const fundRows = (await db.execute(
  sql`SELECT time, rate FROM funding_rates WHERE symbol = 'BTCUSDT' ORDER BY time`,
)) as unknown as Array<{ time: string | number; rate: string | number }>
const funding = new Map<number, number>()
for (const r of fundRows) {
  const t = Number(r.time)
  funding.set(Math.round(t / (8 * 3_600_000)), Number(r.rate))
}
console.log(`funding chargé : ${funding.size} points 8h (2020-01+ ; avant = 0)\n`)
/** somme des funding sur (t0, t1] — le SHORT reçoit +rate (signe Binance : long paie si >0) */
function fundingSum(t0: number, t1: number): number {
  let s = 0
  for (let k = Math.floor(t0 / (8 * 3_600_000)) + 1; k <= Math.floor(t1 / (8 * 3_600_000)); k++) {
    s += funding.get(k) ?? 0
  }
  return s
}

// régime bear : close 1d veille < EMA200 1d veille
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
const bearAt = (i: number) => emaByDay.get(Math.floor(h4[i].openTime / DAY) - 1) === false

const ema50 = (() => {
  const out = new Array<number>(n).fill(NaN)
  const k = 2 / 51
  let e = NaN
  let s = 0
  for (let i = 0; i < n; i++) {
    if (i < 50) {
      s += close[i]
      if (i === 49) { e = s / 50; out[i] = e }
    } else { e = close[i] * k + e * (1 - k); out[i] = e }
  }
  return out
})()
const atr14 = (() => {
  const out = new Array<number>(n).fill(NaN)
  let a = NaN
  for (let i = 0; i < n; i++) {
    const tr = i === 0 ? high[i] - low[i] : Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]))
    a = Number.isNaN(a) ? tr : (a * 13 + tr) / 14
    out[i] = a
  }
  return out
})()
const don55low = (() => {
  const out = new Array<number>(n).fill(NaN)
  const dq: number[] = []
  for (let i = 0; i < n; i++) {
    if (i >= 1) {
      while (dq.length && low[dq[dq.length - 1]] >= low[i - 1]) dq.pop()
      dq.push(i - 1)
      while (dq.length && dq[0] < i - 55) dq.shift()
      if (i >= 55) out[i] = low[dq[0]]
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
const sig = (i: number) => close[i] < don55low[i] && vol[i] > 1.5 * volSma20[i] && bearAt(i)

// ---------- 1. event study ----------
const HZ = [12, 42, 126]
const fwd = (i: number, h: number) => Math.log(close[i + h] / close[i]) * 1e4
const base = new Map<number, number[]>()
for (const h of HZ) {
  const v: number[] = []
  for (let i = startIdx; i < n - 127; i++) if (bearAt(i)) v.push(fwd(i, h))
  base.set(h, v)
}
console.log('══ 1. EVENT STUDY — cassure D55-basse × vol × bear (un short gagne le NÉGATIF) ══')
console.log(`baseline bear : ${HZ.map((h) => `${h}b ${fb(mean(base.get(h)!))}`).join('  ')} bps\n`)
{
  const evs: number[] = []
  let nextOk = 0
  for (let i = Math.max(startIdx, 101); i < n - 127; i++) {
    if (i < nextOk) continue
    if (!sig(i)) continue
    evs.push(i)
    nextOk = i + 42
  }
  const YEARS_SPAN = (TO - FROM) / (365.25 * DAY)
  let row = `événements : n=${evs.length} (${(evs.length / YEARS_SPAN).toFixed(0)}/an)  `
  for (const h of HZ) {
    const v = evs.map((i) => fwd(i, h))
    row += `fwd${h}b ${fb(mean(v))} [tW ${ft(welch(v, base.get(h)!))}]  `
  }
  console.log(row)
  for (const [lab, a, b] of [['18-19', 2018, 2019], ['20-21', 2020, 2021], ['22-23', 2022, 2023], ['24', 2024, 2024]] as const) {
    const sel = evs.filter((i) => {
      const y = new Date(h4[i].openTime).getUTCFullYear()
      return y >= a && y <= b
    })
    const v = sel.map((i) => fwd(i, 42))
    console.log(`  ère ${lab}: n=${String(sel.length).padStart(3)}  fwd42b ${fb(mean(v))}`)
  }
}

// ---------- 2. premier passage SHORT (futures, funding réel) ----------
console.log('\n══ 2. PREMIER PASSAGE SHORT (frais fut. 10 bps RT+slip, funding réel, stop +min(2,5ATR,4%), recross/time) ══')
console.log('exit'.padEnd(12) + 'n'.padStart(5) + '/an'.padStart(6) + 'WR%'.padStart(6) + 'E[net] [t]'.padStart(17) + 'fund/tr'.padStart(9) + 'hold_b'.padStart(8) + 'net/an bps'.padStart(11))
for (const exitKind of ['recross', 'time126'] as const) {
  const net: number[] = []
  const fnd: number[] = []
  let holdSum = 0
  let i = Math.max(startIdx, 101)
  while (i < n - 128) {
    if (!sig(i)) {
      i++
      continue
    }
    const entry = open[i + 1] * (1 - SIDE_FUT) // vente
    const stop = Math.min(close[i] + 2.5 * atr14[i], close[i] * 1.04)
    let exitPx = NaN
    let j = i + 1
    for (; j <= Math.min(i + 126, n - 2); j++) {
      if (high[j] >= stop) { exitPx = stop; break }
      if (exitKind === 'recross' && close[j] > ema50[j]) { exitPx = close[j]; break }
    }
    if (Number.isNaN(exitPx)) {
      j = Math.min(i + 126, n - 2)
      exitPx = close[j]
    }
    const cover = exitPx * (1 + SIDE_FUT)
    const fu = fundingSum(h4[i + 1].openTime, h4[j].openTime) * 1e4 // bps ; short REÇOIT si >0
    const pnl = Math.log(entry / cover) * 1e4 + fu
    net.push(pnl)
    fnd.push(fu)
    holdSum += j - i
    i = j + 1
  }
  const YEARS_SPAN = (TO - FROM) / (365.25 * DAY)
  console.log(
    exitKind.padEnd(12) + String(net.length).padStart(5) + (net.length / YEARS_SPAN).toFixed(0).padStart(6) +
      ((net.filter((x) => x > 0).length / net.length) * 100).toFixed(0).padStart(5) + '%' +
      `${fb(mean(net))} [${ft(tstat(net))}]`.padStart(17) + fb(mean(fnd), 9) + (holdSum / net.length).toFixed(0).padStart(8) +
      fb((mean(net) * net.length) / YEARS_SPAN, 11),
  )
}
process.exit(0)
