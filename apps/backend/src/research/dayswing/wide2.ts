/**
 * Vague 2 — BALAYAGE LARGE n°2 : familles STRUCTURELLES du récap utilisateur,
 * formalisées avec le moteur de pivots/zigzag (enfin possibles proprement) :
 *   - bull flag / pennant : pole (impulsion ≥ 2×ATR) + consolidation contre-
 *     tendance compacte + cassure du haut du drapeau, ± confirmation volume ;
 *   - combo i du récap : uptrend + pullback en zone Fib 55-70 % + RSI<35 ;
 *   - combo iv approx : « vague 2 » zigzag (jambe up ≥ 2 ATR, retracement
 *     38-78 %, stoch %K×%D ↑ sous 25) ;
 *   - inverse head & shoulders (3 pivots bas, tête au centre, épaules ±25 %,
 *     cassure de la neckline) — la variante LONG de la combo ii.
 * Même protocole que wide1 : gate bull, dé-chevauchement, baseline appariée,
 * t de Welch, ères. Cibles « measured move » mesurées en fin de tableau pour
 * les flags (P(TP=pole avant stop=bas du drapeau)).
 *   bun apps/backend/src/research/dayswing/wide2.ts [--symbol=BTCUSDT] [--itv=4h]
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
const HZ = ITV === '1d' ? [3, 7, 21] : ITV === '1h' ? [24, 72, 168] : [12, 42, 126]
const GAP = HZ[1]

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

const atr = (() => {
  const out = new Array<number>(n).fill(NaN)
  let a = NaN
  for (let i = 0; i < n; i++) {
    const tr = i === 0 ? high[i] - low[i] : Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]))
    a = Number.isNaN(a) ? tr : (a * 13 + tr) / 14
    out[i] = a
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
// RSI14 + stoch (pour combos i et iv)
const rsi14 = (() => {
  const out = new Array<number>(n).fill(NaN)
  let up = 0
  let dn = 0
  for (let i = 1; i < n; i++) {
    const ch = close[i] - close[i - 1]
    const u = Math.max(ch, 0)
    const d = Math.max(-ch, 0)
    if (i <= 14) {
      up += u / 14
      dn += d / 14
      if (i === 14) out[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn)
    } else {
      up = (up * 13 + u) / 14
      dn = (dn * 13 + d) / 14
      out[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn)
    }
  }
  return out
})()
const stochKs = (() => {
  const k = new Array<number>(n).fill(50)
  for (let i = 13; i < n; i++) {
    let hh = -Infinity
    let ll = Infinity
    for (let j = i - 13; j <= i; j++) {
      hh = Math.max(hh, high[j])
      ll = Math.min(ll, low[j])
    }
    k[i] = hh === ll ? 50 : ((close[i] - ll) / (hh - ll)) * 100
  }
  const out = new Array<number>(n).fill(NaN)
  for (let i = 2; i < n; i++) out[i] = (k[i] + k[i - 1] + k[i - 2]) / 3
  return out
})()
const stochD = (() => {
  const out = new Array<number>(n).fill(NaN)
  for (let i = 4; i < n; i++) out[i] = (stochKs[i] + stochKs[i - 1] + stochKs[i - 2]) / 3
  return out
})()

// pivots prix (bas/hauts) L=5, lag de confirmation = 5 barres
interface Piv { i: number; conf: number; v: number }
function pivots(src: number[], L: number, kind: 'high' | 'low'): Piv[] {
  const out: Piv[] = []
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
const pHi = pivots(high, 5, 'high')
const pLo = pivots(low, 5, 'low')

// ---------- détection des familles → map barre → event ----------
// 1) BULL FLAG / PENNANT : pole = ret(p barres) ≥ 2×ATR ; drapeau = f∈[3,10] barres,
//    drift ∈ [-60%, +10%] du pole, range du drapeau ≤ 55% du pole ; cassure = close > haut du drapeau.
interface FlagEv { i: number; poleBps: number; flagLow: number; volOk: boolean; kind: 'flag' | 'pennant' }
const flagEvents: FlagEv[] = []
{
  const P = 5
  for (let i = P + 12; i < n - HZ[2] - 1; i++) {
    // cherche un pole finissant en j, drapeau de f barres, cassure en i
    for (let f = 3; f <= 10; f++) {
      const j = i - f // fin du pole
      const poleH = close[j] - close[j - P]
      if (poleH < 2 * atr[j]) continue
      let fHi = -Infinity
      let fLo = Infinity
      for (let k = j + 1; k < i; k++) {
        fHi = Math.max(fHi, high[k])
        fLo = Math.min(fLo, low[k])
      }
      if (!(fHi - fLo <= 0.55 * poleH)) continue
      const drift = close[i - 1] - close[j]
      if (drift < -0.6 * poleH || drift > 0.1 * poleH) continue
      if (!(close[i] > fHi)) continue
      // pennant = compression (2e moitié du drapeau plus étroite), flag = canal
      let h1 = -Infinity
      let l1 = Infinity
      let h2 = -Infinity
      let l2 = Infinity
      const midK = j + 1 + Math.floor((f - 1) / 2)
      for (let k = j + 1; k < i; k++) {
        if (k < midK) {
          h1 = Math.max(h1, high[k])
          l1 = Math.min(l1, low[k])
        } else {
          h2 = Math.max(h2, high[k])
          l2 = Math.min(l2, low[k])
        }
      }
      flagEvents.push({
        i,
        poleBps: (poleH / close[j]) * 1e4,
        flagLow: fLo,
        volOk: vol[i] > 1.5 * volSma20[i],
        kind: h2 - l2 < 0.7 * (h1 - l1) ? 'pennant' : 'flag',
      })
      break // un seul f par barre de cassure
    }
  }
}
// 2) COMBO i : uptrend (gate bull) + zone fib 55-70% de la dernière jambe zigzag up + RSI<35
//    jambe = dernier pivot bas confirmé → dernier pivot haut confirmé (haut après bas)
interface FibEv { i: number }
const fibEvents: FibEv[] = []
{
  let hiIdx = 0
  let loIdx = 0
  for (let i = startIdx; i < n - HZ[2] - 1; i++) {
    while (hiIdx < pHi.length && pHi[hiIdx].conf <= i) hiIdx++
    while (loIdx < pLo.length && pLo[loIdx].conf <= i) loIdx++
    const lastHi = hiIdx > 0 ? pHi[hiIdx - 1] : null
    const lastLo = loIdx > 0 ? pLo[loIdx - 1] : null
    if (!lastHi || !lastLo || lastHi.i <= lastLo.i) continue // il faut une jambe up terminée par un haut
    const leg = lastHi.v - lastLo.v
    if (leg < 2 * atr[lastHi.i]) continue
    const zTop = lastHi.v - 0.55 * leg
    const zBot = lastHi.v - 0.7 * leg
    if (low[i] <= zTop && low[i] >= zBot - 0.15 * leg && close[i] > zBot && rsi14[i] < 35) fibEvents.push({ i })
  }
}
// 3) COMBO iv « vague 2 » : même jambe up ; retracement courant 38-78% ; stoch %K×%D ↑ sous 25
const waveEvents: number[] = []
{
  let hiIdx = 0
  let loIdx = 0
  for (let i = startIdx; i < n - HZ[2] - 1; i++) {
    while (hiIdx < pHi.length && pHi[hiIdx].conf <= i) hiIdx++
    while (loIdx < pLo.length && pLo[loIdx].conf <= i) loIdx++
    const lastHi = hiIdx > 0 ? pHi[hiIdx - 1] : null
    const lastLo = loIdx > 0 ? pLo[loIdx - 1] : null
    if (!lastHi || !lastLo || lastHi.i <= lastLo.i) continue
    const leg = lastHi.v - lastLo.v
    if (leg < 2 * atr[lastHi.i]) continue
    const retr = (lastHi.v - low[i]) / leg
    if (retr < 0.38 || retr > 0.78) continue
    if (stochKs[i] > stochD[i] && stochKs[i - 1] <= stochD[i - 1] && stochKs[i] < 25) waveEvents.push(i)
  }
}
// 4) INVERSE H&S : 3 pivots bas consécutifs (confirmés), tête au centre la plus basse,
//    épaules à ±25% de la profondeur de tête, neckline = max(high) entre épaules ; event = close > neckline.
const ihsEvents: number[] = []
{
  for (let k = 2; k < pLo.length; k++) {
    const [s1, hd, s2] = [pLo[k - 2], pLo[k - 1], pLo[k]]
    if (!(hd.v < s1.v && hd.v < s2.v)) continue
    if (s2.i - s1.i > 80) continue
    let neck = -Infinity
    for (let j = s1.i; j <= s2.i; j++) neck = Math.max(neck, high[j])
    const depth = neck - hd.v
    if (depth < 2 * atr[hd.i]) continue
    if (Math.abs(s1.v - s2.v) > 0.25 * depth) continue
    // cherche la cassure de neckline dans les 40 barres après confirmation de s2
    for (let i = s2.conf; i < Math.min(s2.conf + 40, n - HZ[2] - 1); i++) {
      if (close[i] > neck) {
        ihsEvents.push(i)
        break
      }
    }
  }
}

// ---------- reporting commun ----------
const fwd = (i: number, h: number) => Math.log(close[i + h] / close[i]) * 1e4
const basePerH = new Map<number, number[]>()
for (const h of HZ) {
  const v: number[] = []
  for (let i = startIdx; i < n - HZ[2] - 1; i++) if (bullAt(i)) v.push(fwd(i, h))
  basePerH.set(h, v)
}
const ERAS: Array<[string, number, number]> = [['18-19', 2018, 2019], ['20-21', 2020, 2021], ['22-23', 2022, 2023], ['24', 2024, 2024]]
const YEARS_SPAN = (TO - FROM) / (365.25 * DAY)

function dedup(idx: number[]): number[] {
  const out: number[] = []
  let nextOk = 0
  for (const i of [...idx].sort((a, b) => a - b)) {
    if (i < nextOk || i < startIdx) continue
    if (!bullAt(i)) continue
    out.push(i)
    nextOk = i + GAP
  }
  return out
}
function report(label: string, idx: number[]): void {
  const evs = dedup(idx)
  if (evs.length < 20) {
    console.log(label.padEnd(44) + `n=${evs.length} (trop peu)`)
    return
  }
  let row = label.padEnd(44) + String(evs.length).padStart(5) + (evs.length / YEARS_SPAN).toFixed(0).padStart(5)
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

console.log(`WIDE-2 structures — ${SYMBOL} ${ITV} 2018→2025-01 · gate bull · dé-chevauché ${GAP} barres`)
console.log(`baseline bull : ${HZ.map((h) => `${h}b ${fb(mean(basePerH.get(h)!))}`).join('  ')}\n`)
console.log('famille'.padEnd(44) + 'n'.padStart(5) + '/an'.padStart(5) + HZ.map((h) => `fwd${h}b [tW]`.padStart(17)).join('') + '  ères (fwd' + HZ[1] + 'b)')

report('Bull flag cassure (pole 2ATR)', flagEvents.map((e) => e.i))
report('  … × volume>1,5×SMA20 (combo iii récap)', flagEvents.filter((e) => e.volOk).map((e) => e.i))
report('  … pennants seulement', flagEvents.filter((e) => e.kind === 'pennant').map((e) => e.i))
report('Fib 55-70% × RSI<35 (combo i récap)', fibEvents.map((e) => e.i))
report('« Vague 2 » zigzag × stoch (combo iv récap)', waveEvents)
report('Inverse H&S cassure neckline (combo ii inv.)', ihsEvents)

// measured move des flags : P(TP = +pole avant stop = bas du drapeau)
{
  const evs = dedup(flagEvents.map((e) => e.i))
  const byI = new Map(flagEvents.map((e) => [e.i, e]))
  let tp = 0
  let sl = 0
  let to = 0
  const rrs: number[] = []
  for (const i of evs) {
    const e = byI.get(i)!
    const entry = close[i]
    const target = entry * (1 + e.poleBps / 1e4)
    const stop = e.flagLow
    if (stop >= entry) continue
    rrs.push((target - entry) / (entry - stop))
    let done = false
    for (let j = i + 1; j <= Math.min(i + HZ[2], n - 1); j++) {
      if (low[j] <= stop) {
        sl++
        done = true
        break
      }
      if (high[j] >= target) {
        tp++
        done = true
        break
      }
    }
    if (!done) to++
  }
  const wr = tp / Math.max(1, tp + sl + to)
  console.log(`\nmeasured move flags : TP(+pole)/stop(bas drapeau)/timeout = ${tp}/${sl}/${to} · WR ${(wr * 100).toFixed(0)}% · R:R médian ${rrs.sort((a, b) => a - b)[Math.floor(rrs.length / 2)]?.toFixed(2) ?? '—'}`)
}
process.exit(0)
