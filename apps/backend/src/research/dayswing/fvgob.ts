/**
 * Annexe campagne — test des « 5 étoiles » order blocks (vidéo YouTube, 2026-07-09).
 * Historique repo : OB déjà formalisés et réfutés standalone (2026-06 : OOS PF 0,60,
 * -20,8 %) ; zones de vente accumulateur réfutées (G6). Ici on teste la SEULE brique
 * jamais testée : l'imbalance/FVG (étoile 1) comme filtre de qualité de zone, plus
 * la valeur marginale mesurée des étoiles 3 (discount 0,5) et 5 (mitigation).
 *
 * Formalisation mécanique (bullish, cohérente avec research/orderblocks.ts) :
 *  - OB = bougie baissière i suivie d'un déplacement : close(i+3) ≥ close(i) + 2×ATR(i)
 *  - FVG (étoile 1) = low(i+2) > high(i) (le gap des 3 bougies de la vidéo)
 *  - étoile 2 (tendance) : IMPOSÉE partout — régime bull (veille > EMA200 1d), OB bullish only
 *  - étoile 3 (discount) : haut de zone sous le milieu du range 96 barres
 *  - étoile 5 (mitigation) : 1ʳᵉ visite de la zone vs revisites
 *  - événement = retour du prix DANS la zone [low(i), high(i)] (low(j) ≤ top, close(j-1) > top)
 *  - invalidation : close < bas de zone ; expiration 500 barres ; une zone = un event max/barre
 *  - variante « reject » (l'entrée-confirmation de la vidéo) : close(j) recl��ture > top
 * Mesure : E[fwd 4/8/24/48h] depuis close(j) vs baseline bull, t de Welch, par ère.
 *   bun apps/backend/src/research/dayswing/fvgob.ts [--from=2019-01-01] [--to=2025-01-01] [--interval=1h]
 */
import { createDb } from '@tpx/db'
import { CandleStore } from '@tpx/data'
import type { Candle, Interval } from '@tpx/shared'

const arg = (name: string, dflt: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? dflt
const FROM = Date.parse(arg('from', '2019-01-01') + 'T00:00:00Z')
const TO = Date.parse(arg('to', '2025-01-01') + 'T00:00:00Z')
const ITV = arg('interval', '1h') as Interval
const DAY = 86_400_000

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN)
const sd = (v: number[]) => {
  if (v.length < 2) return NaN
  const m = mean(v)
  return Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / (v.length - 1))
}
const welch = (a: number[], b: number[]) =>
  (mean(a) - mean(b)) / Math.sqrt((sd(a) ** 2) / a.length + (sd(b) ** 2) / b.length)
const fb = (x: number, w = 7) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(1) : '—').padStart(w)
const ft = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '—').padStart(5)

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const store = new CandleStore(db)
const cs = await store.getCandles('spot', 'BTCUSDT', ITV, FROM - 30 * DAY, TO)
const d1 = await store.getCandles('spot', 'BTCUSDT', '1d', FROM - 320 * DAY, TO)

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
const isBull = (t: number) => emaByDay.get(Math.floor(t / DAY) - 1) === true

const n = cs.length
const startIdx = cs.findIndex((c) => c.openTime >= FROM)
// ATR + range 96 barres (milieu = frontière discount/premium)
const atr = new Array<number>(n).fill(NaN)
const mid96 = new Array<number>(n).fill(NaN)
{
  let a = NaN
  let prevClose = NaN
  for (let i = 0; i < n; i++) {
    const tr = Number.isNaN(prevClose)
      ? cs[i].high - cs[i].low
      : Math.max(cs[i].high - cs[i].low, Math.abs(cs[i].high - prevClose), Math.abs(cs[i].low - prevClose))
    a = Number.isNaN(a) ? tr : (a * 13 + tr) / 14
    atr[i] = a
    prevClose = cs[i].close
    if (i >= 96) {
      let hi = -Infinity
      let lo = Infinity
      for (let j = i - 96; j < i; j++) {
        hi = Math.max(hi, cs[j].high)
        lo = Math.min(lo, cs[j].low)
      }
      mid96[i] = (hi + lo) / 2
    }
  }
}

interface Zone { top: number; bottom: number; born: number; fvg: boolean; touches: number }
interface Ev { i: number; fvg: boolean; discount: boolean; firstTouch: boolean; reject: boolean }
const zones: Zone[] = []
const events: Ev[] = []

for (let i = 4; i < n - 49; i++) {
  // création : bougie baissière en i-3 + déplacement 2×ATR sur les 3 suivantes + OB bullish only
  const ob = i - 3
  if (cs[ob].close < cs[ob].open && cs[i].close >= cs[ob].close + 2 * atr[ob]) {
    zones.push({ top: cs[ob].high, bottom: cs[ob].low, born: i, fvg: cs[ob + 2].low > cs[ob].high, touches: 0 })
  }
  // gestion des zones actives + événements (1 event max par barre : la plus proche)
  let taken = false
  for (let z = zones.length - 1; z >= 0; z--) {
    const zn = zones[z]
    if (i - zn.born > 500 || cs[i].close < zn.bottom) {
      zones.splice(z, 1)
      continue
    }
    if (taken || i <= zn.born) continue
    if (cs[i].low <= zn.top && cs[i - 1].close > zn.top) {
      if (i >= startIdx && isBull(cs[i].openTime) && Number.isFinite(mid96[i])) {
        events.push({
          i,
          fvg: zn.fvg,
          discount: zn.top < mid96[i],
          firstTouch: zn.touches === 0,
          reject: cs[i].close > zn.top,
        })
        taken = true
      }
      zn.touches++
    }
  }
}

const HORIZONS = [4, 8, 24, 48]
const fwd = (i: number, h: number) => Math.log(cs[i + h].close / cs[i].close) * 1e4
const baseline = new Map<number, number[]>()
for (const h of HORIZONS) {
  const v: number[] = []
  for (let i = startIdx; i < n - 49; i++) if (isBull(cs[i].openTime)) v.push(fwd(i, h))
  baseline.set(h, v)
}

console.log(`FVG-OB « 5 étoiles » — BTCUSDT ${ITV}, ${arg('from', '2019-01-01')} → ${arg('to', '2025-01-01')}`)
console.log(`zones bull-only (étoile 2 imposée), ${events.length} retours en zone · baseline bull : ${HORIZONS.map((h) => `${h}h ${fb(mean(baseline.get(h)!))}`).join(' ')}\n`)

function report(label: string, sel: Ev[]): void {
  if (sel.length < 30) {
    console.log(label.padEnd(46) + `n=${sel.length} (trop peu)`)
    return
  }
  let row = label.padEnd(46) + String(sel.length).padStart(5)
  for (const h of HORIZONS) {
    const v = sel.map((e) => fwd(e.i, h))
    const t = welch(v, baseline.get(h)!)
    row += `${fb(mean(v))} [${ft(t)}]`.padStart(18)
  }
  console.log(row)
}
console.log('condition'.padEnd(46) + 'n'.padStart(5) + HORIZONS.map((h) => `fwd${h}h [tW]`.padStart(18)).join(''))
report('tous les retours en zone', events)
report('★1 FVG', events.filter((e) => e.fvg))
report('sans FVG (contrôle)', events.filter((e) => !e.fvg))
report('★5 première visite', events.filter((e) => e.firstTouch))
report('revisites (mitigés — contrôle)', events.filter((e) => !e.firstTouch))
report('★3 discount (zone < mid96)', events.filter((e) => e.discount))
report('premium (contrôle)', events.filter((e) => !e.discount))
report('★1+3+5 (FVG × discount × 1ʳᵉ visite)', events.filter((e) => e.fvg && e.discount && e.firstTouch))
report('  … + reject (l’entrée-confirmation vidéo)', events.filter((e) => e.fvg && e.discount && e.firstTouch && e.reject))
report('5★ SANS reject (limite passive)', events.filter((e) => e.fvg && e.discount && e.firstTouch && !e.reject))

// stabilité par ère de la cellule 5★
console.log('\n5★ par ère (fwd24h) :')
for (const [lab, a, b] of [['2019-20', 2019, 2020], ['2021-23', 2021, 2023], ['2024', 2024, 2024]] as const) {
  const sel = events.filter((e) => {
    const y = new Date(cs[e.i].openTime).getUTCFullYear()
    return e.fvg && e.discount && e.firstTouch && y >= a && y <= b
  })
  const v = sel.map((e) => fwd(e.i, 24))
  console.log(`  ${lab}: n=${sel.length}  E=${fb(mean(v))} [t vs bull ${ft(sel.length > 10 ? welch(v, baseline.get(24)!) : NaN)}]`)
}
process.exit(0)
