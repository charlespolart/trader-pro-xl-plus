/**
 * Vague 2 — BALAYAGE LARGE n°1 : familles oscillateurs/indicateurs du récap
 * utilisateur (recap-trading.html) jamais testées dans le repo : MACD (croix,
 * zéro, histogramme), Stochastique, variantes RSI, pullback-EMA, Donchian
 * long-only quote, Supertrend, ADX-join, DIVERGENCES prix/oscillateur
 * (formalisées par pivots à lag de confirmation explicite), couche volume.
 *
 * Protocole : event study, long only, gate de régime bull (veille>EMA200 1d) —
 * le fait D5 (les longs s'inversent en bear) l'impose ; événements
 * DÉ-CHEVAUCHÉS au pas du plus grand horizon ; E[fwd] vs baseline bull
 * appariée, t de Welch ; stabilité par ère (2018-19 / 2020-21 / 2022-23 /
 * 2024) ; RSI(2)<10 inclus comme CONTRÔLE NÉGATIF (réfuté 2026-06 — doit
 * sortir ≈ 0/négatif, sinon le harnais ment).
 * IS élargi : 2018-01 → 2025-01 (2018 documenté au ledger comme consommé pour
 * ces familles). OOS 2025+ et holdout : PAS touchés ici.
 *
 *   bun apps/backend/src/research/dayswing/wide1.ts [--symbol=BTCUSDT] [--itv=4h] [--nogate]
 */
import { createDb } from '@tpx/db'
import { CandleStore } from '@tpx/data'
import type { Candle, Interval } from '@tpx/shared'

const arg = (name: string, dflt: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? dflt
const SYMBOL = arg('symbol', 'BTCUSDT')
const ITV = arg('itv', '4h') as Interval
const GATE = !process.argv.includes('--nogate')
const FROM = Date.parse('2018-01-01T00:00:00Z')
const TO = Date.parse('2025-01-01T00:00:00Z')
const DAY = 86_400_000

// horizons en barres selon l'UT (jusqu'à ~3 semaines : « horizon plus large »)
const HORIZONS: Record<string, number[]> = {
  '1h': [24, 72, 168],
  '4h': [12, 42, 126],
  '1d': [3, 7, 21],
}
const HZ = HORIZONS[ITV] ?? [12, 42, 126]
const GAP = HZ[1] // dé-chevauchement au pas de l'horizon médian (compromis n/propreté)

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN)
const sd = (v: number[]) => {
  if (v.length < 2) return NaN
  const m = mean(v)
  return Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / (v.length - 1))
}
const welch = (a: number[], b: number[]) =>
  (mean(a) - mean(b)) / Math.sqrt((sd(a) ** 2) / a.length + (sd(b) ** 2) / b.length)
const fb = (x: number, w = 7) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(0) : '—').padStart(w)
const ft = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '—').padStart(5)

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const store = new CandleStore(db)
const cs = await store.getCandles('spot', SYMBOL, ITV, FROM - 60 * DAY, TO)
const d1 = await store.getCandles('spot', SYMBOL, '1d', FROM - 320 * DAY, TO)
const n = cs.length
const startIdx = cs.findIndex((c) => c.openTime >= FROM)

// ---------- régime ----------
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
const bullAt = (t: number) => emaByDay.get(Math.floor(t / DAY) - 1) === true
const gateOk = (i: number) => !GATE || bullAt(cs[i].openTime)

// ---------- indicateurs batch ----------
const close = cs.map((c) => c.close)
const high = cs.map((c) => c.high)
const low = cs.map((c) => c.low)
const vol = cs.map((c) => c.volume)

function emaArr(src: number[], p: number): number[] {
  const out = new Array<number>(src.length).fill(NaN)
  const k = 2 / (p + 1)
  let e = NaN
  let seedSum = 0
  for (let i = 0; i < src.length; i++) {
    if (i < p) {
      seedSum += src[i]
      if (i === p - 1) {
        e = seedSum / p
        out[i] = e
      }
    } else {
      e = src[i] * k + e * (1 - k)
      out[i] = e
    }
  }
  return out
}
function smaArr(src: number[], p: number): number[] {
  const out = new Array<number>(src.length).fill(NaN)
  let s = 0
  for (let i = 0; i < src.length; i++) {
    s += src[i]
    if (i >= p) s -= src[i - p]
    if (i >= p - 1) out[i] = s / p
  }
  return out
}
function rsiArr(p: number): number[] {
  const out = new Array<number>(n).fill(NaN)
  let up = 0
  let dn = 0
  for (let i = 1; i < n; i++) {
    const ch = close[i] - close[i - 1]
    const u = Math.max(ch, 0)
    const d = Math.max(-ch, 0)
    if (i <= p) {
      up += u / p
      dn += d / p
      if (i === p) out[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn)
    } else {
      up = (up * (p - 1) + u) / p
      dn = (dn * (p - 1) + d) / p
      out[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn)
    }
  }
  return out
}
const atrArr = (() => {
  const out = new Array<number>(n).fill(NaN)
  let a = NaN
  for (let i = 0; i < n; i++) {
    const tr = i === 0 ? high[i] - low[i] : Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]))
    a = Number.isNaN(a) ? tr : (a * 13 + tr) / 14
    out[i] = a
  }
  return out
})()
// MACD 12/26/9 (le 12/24/9 du récap testé en sensibilité si survivant)
const ema12 = emaArr(close, 12)
const ema26 = emaArr(close, 26)
const macd = close.map((_, i) => ema12[i] - ema26[i])
const macdSig = emaArr(macd.map((x) => (Number.isFinite(x) ? x : 0)), 9)
const macdHist = macd.map((x, i) => x - macdSig[i])
// Stoch 14/3/3
const stochK: number[] = new Array(n).fill(NaN)
{
  for (let i = 13; i < n; i++) {
    let hh = -Infinity
    let ll = Infinity
    for (let j = i - 13; j <= i; j++) {
      hh = Math.max(hh, high[j])
      ll = Math.min(ll, low[j])
    }
    stochK[i] = hh === ll ? 50 : ((close[i] - ll) / (hh - ll)) * 100
  }
}
const stochKs = smaArr(stochK.map((x) => (Number.isFinite(x) ? x : 50)), 3)
const stochD = smaArr(stochKs, 3)
const rsi14 = rsiArr(14)
const rsi2 = rsiArr(2)
const ema20 = emaArr(close, 20)
const ema50 = emaArr(close, 50)
const volSma20 = smaArr(vol, 20)
// Donchian 20/55 (plus haut des p barres PRÉCÉDENTES)
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
const don20 = donchHi(20)
const don55 = donchHi(55)
// Supertrend (10, 3)
const stDir: number[] = new Array(n).fill(0) // 1 up, -1 down
{
  let upBand = NaN
  let dnBand = NaN
  let dir = 1
  for (let i = 1; i < n; i++) {
    const mid = (high[i] + low[i]) / 2
    const bu = mid + 3 * atrArr[i]
    const bl = mid - 3 * atrArr[i]
    upBand = Number.isNaN(upBand) || bu < upBand || close[i - 1] > upBand ? bu : upBand
    dnBand = Number.isNaN(dnBand) || bl > dnBand || close[i - 1] < dnBand ? bl : dnBand
    if (dir === 1 && close[i] < dnBand) dir = -1
    else if (dir === -1 && close[i] > upBand) dir = 1
    stDir[i] = dir
  }
}
// ADX 14 (Wilder)
const adx: number[] = new Array(n).fill(NaN)
{
  let trS = 0
  let pS = 0
  let mS = 0
  let dxAvg = NaN
  for (let i = 1; i < n; i++) {
    const upM = high[i] - high[i - 1]
    const dnM = low[i - 1] - low[i]
    const pdm = upM > dnM && upM > 0 ? upM : 0
    const mdm = dnM > upM && dnM > 0 ? dnM : 0
    const tr = Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]))
    if (i <= 14) {
      trS += tr
      pS += pdm
      mS += mdm
      if (i === 14) {
        const pdi = (100 * pS) / trS
        const mdi = (100 * mS) / trS
        dxAvg = (100 * Math.abs(pdi - mdi)) / (pdi + mdi)
      }
    } else {
      trS = trS - trS / 14 + tr
      pS = pS - pS / 14 + pdm
      mS = mS - mS / 14 + mdm
      const pdi = (100 * pS) / trS
      const mdi = (100 * mS) / trS
      const dx = (100 * Math.abs(pdi - mdi)) / (pdi + mdi)
      dxAvg = Number.isNaN(dxAvg) ? dx : (dxAvg * 13 + dx) / 14
      adx[i] = dxAvg
    }
  }
}
// pivots tableau avec lag de confirmation explicite (pour les divergences)
function arrPivots(src: number[], L: number, kind: 'high' | 'low'): Array<{ i: number; conf: number; v: number }> {
  const out: Array<{ i: number; conf: number; v: number }> = []
  for (let i = L; i < src.length - L; i++) {
    let ok = true
    for (let k = 1; k <= L && ok; k++) {
      if (kind === 'high') ok = src[i] > src[i - k] && src[i] >= src[i + k]
      else ok = src[i] < src[i - k] && src[i] <= src[i + k]
    }
    if (ok) out.push({ i, conf: i + L, v: src[i] })
  }
  return out
}

// ---------- familles (signal booléen par barre) ----------
const cross = (a: number[], b: number[], i: number) => a[i] > b[i] && a[i - 1] <= b[i - 1]
const crossLvl = (a: number[], lvl: number, i: number) => a[i] > lvl && a[i - 1] <= lvl

// divergences haussières : prix fait un LL (pivot bas), oscillateur fait un HL — connues au conf du 2e pivot
function bullDivEvents(osc: number[]): Set<number> {
  const pl = arrPivots(low, 5, 'low')
  const out = new Set<number>()
  for (let k = 1; k < pl.length; k++) {
    const a = pl[k - 1]
    const b = pl[k]
    if (b.i - a.i > 60) continue
    if (b.v < a.v && osc[b.i] > osc[a.i] && Number.isFinite(osc[a.i])) out.add(b.conf)
  }
  return out
}
const rsiDiv = bullDivEvents(rsi14)
const macdDiv = bullDivEvents(macd)

interface Family { name: string; sig: (i: number) => boolean }
const FAMILIES: Family[] = [
  { name: 'MACD croix ↑ (12/26/9)', sig: (i) => cross(macd, macdSig, i) },
  { name: 'MACD croix ↑ × MACD>0', sig: (i) => cross(macd, macdSig, i) && macd[i] > 0 },
  { name: 'MACD croix ↑ sous zéro (le « dip »)', sig: (i) => cross(macd, macdSig, i) && macd[i] < 0 },
  { name: 'MACD histogramme retourne ↑ (2 barres)', sig: (i) => macdHist[i] > macdHist[i - 1] && macdHist[i - 1] < macdHist[i - 2] && macdHist[i] < 0 },
  { name: 'Stoch %K×%D ↑ en zone <20', sig: (i) => cross(stochKs, stochD, i) && stochKs[i] < 25 },
  { name: 'RSI14 recroise ↑ 30', sig: (i) => crossLvl(rsi14, 30, i) },
  { name: 'RSI14 recroise ↑ 50 (momentum)', sig: (i) => crossLvl(rsi14, 50, i) },
  { name: 'RSI2 < 10 (CONTRÔLE NÉGATIF — réfuté 06)', sig: (i) => rsi2[i] < 10 },
  { name: 'Pullback EMA20 : touche + reclôture', sig: (i) => low[i] <= ema20[i] && close[i] > ema20[i] && close[i - 1] > ema20[i - 1] && ema20[i] > ema50[i] },
  { name: 'Pullback EMA50 : touche + reclôture', sig: (i) => low[i] <= ema50[i] && close[i] > ema50[i] && close[i - 1] > ema50[i - 1] },
  { name: 'Donchian 20 cassure ↑', sig: (i) => close[i] > don20[i] },
  { name: 'Donchian 55 cassure ↑', sig: (i) => close[i] > don55[i] },
  { name: 'Donchian 55 ↑ × volume>1,5×SMA20', sig: (i) => close[i] > don55[i] && vol[i] > 1.5 * volSma20[i] },
  { name: 'Supertrend flip ↑ (10,3)', sig: (i) => stDir[i] === 1 && stDir[i - 1] === -1 },
  { name: 'ADX>25 × close>EMA50 (join trend)', sig: (i) => adx[i] > 25 && adx[i - 1] <= 25 && close[i] > ema50[i] },
  { name: 'Divergence RSI haussière (pivots L5)', sig: (i) => rsiDiv.has(i) },
  { name: 'Divergence MACD haussière (pivots L5)', sig: (i) => macdDiv.has(i) },
]

// ---------- moteur d'event study ----------
const fwd = (i: number, h: number) => Math.log(close[i + h] / close[i]) * 1e4
const maxH = HZ[HZ.length - 1]
const basePerH = new Map<number, number[]>()
for (const h of HZ) {
  const v: number[] = []
  for (let i = startIdx; i < n - maxH - 1; i++) if (gateOk(i)) v.push(fwd(i, h))
  basePerH.set(h, v)
}
const ERAS: Array<[string, number, number]> = [['18-19', 2018, 2019], ['20-21', 2020, 2021], ['22-23', 2022, 2023], ['24', 2024, 2024]]

console.log(`WIDE-1 — ${SYMBOL} ${ITV} 2018→2025-01 · gate régime ${GATE ? 'ON' : 'OFF'} · dé-chevauché ${GAP} barres`)
console.log(`baseline${GATE ? ' bull' : ''} : ${HZ.map((h) => `${h}b ${fb(mean(basePerH.get(h)!))}`).join('  ')}  (bps)\n`)
console.log('famille'.padEnd(42) + 'n'.padStart(5) + '/an'.padStart(5) + HZ.map((h) => `fwd${h}b [tW]`.padStart(17)).join('') + '  ères fwd' + HZ[1] + 'b (18-19|20-21|22-23|24)')

const YEARS_SPAN = (TO - FROM) / (365.25 * DAY)
for (const fam of FAMILIES) {
  const evs: number[] = []
  let nextOk = 0
  for (let i = Math.max(startIdx, 60); i < n - maxH - 1; i++) {
    if (i < nextOk) continue
    let s = false
    try {
      s = fam.sig(i)
    } catch {}
    if (!s || !gateOk(i)) continue
    evs.push(i)
    nextOk = i + GAP
  }
  if (evs.length < 25) {
    console.log(fam.name.padEnd(42) + String(evs.length).padStart(5) + '  (trop peu)')
    continue
  }
  let row = fam.name.padEnd(42) + String(evs.length).padStart(5) + (evs.length / YEARS_SPAN).toFixed(0).padStart(5)
  for (const h of HZ) {
    const v = evs.map((i) => fwd(i, h))
    row += `${fb(mean(v))} [${ft(welch(v, basePerH.get(h)!))}]`.padStart(17)
  }
  const eras = ERAS.map(([, a, b]) => {
    const sel = evs.filter((i) => {
      const y = new Date(cs[i].openTime).getUTCFullYear()
      return y >= a && y <= b
    })
    return sel.length >= 5 ? fb(mean(sel.map((i) => fwd(i, HZ[1]))), 6) : '    (–)'
  })
  console.log(row + '  ' + eras.join('|'))
}
process.exit(0)
