/**
 * Support/Résistance pour améliorer l'EXIT de l'accumulateur ?
 * Thèse (utilisateur) : le rachat sur recroisement d'EMA tombe souvent sur un
 * rebond qui TAPE une résistance puis rechute → on rachète trop tôt. Si on
 * détecte la résistance, on tient le short → plus de profit.
 *
 * Détecteur S/R = pivots fractals (plus-hauts locaux), no-lookahead (une
 * résistance n'est CONNUE que L bougies après sa formation).
 *
 * Test : aux recroisements EMA-haut en régime bear (= le signal de rachat),
 * la proximité d'une résistance au-dessus prédit-elle une RECHUTE (rendement
 * forward négatif = on aurait dû tenir) ?
 *
 *   bun apps/backend/src/research/sr.ts
 */
import { resolve } from 'node:path'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../data') })

const START = Date.parse('2019-01-01T00:00:00Z')
const END = Date.parse('2026-06-13T00:00:00Z')
const candles = await provider.getCandles('spot', 'BTCUSDT', '4h', START, END)
const n = candles.length
const high = candles.map((c) => c.high)
const low = candles.map((c) => c.low)
const close = candles.map((c) => c.close)

function ema(vals: number[], len: number): number[] {
  const k = 2 / (len + 1)
  const out: number[] = []
  let prev = vals[0]!
  for (let i = 0; i < vals.length; i++) {
    prev = i === 0 ? vals[0]! : vals[i]! * k + prev * (1 - k)
    out.push(prev)
  }
  return out
}
const ema50 = ema(close, 50)

// ---- pivots fractals (plus-hauts locaux), L bougies de chaque côté
const L = 3
const W = 120 // fenêtre de validité d'une résistance (~20 jours en 4h)
const swingHi: number[] = [] // indices des plus-hauts locaux, ascendant
for (let i = L; i < n - L; i++) {
  let ok = true
  for (let j = i - L; j <= i + L; j++)
    if (high[j]! > high[i]!) {
      ok = false
      break
    }
  if (ok) swingHi.push(i)
}
// résistance la plus proche AU-DESSUS du close[i], connue à i (formée+confirmée
// depuis ≥L bougies), dans la fenêtre W. Renvoie le prix ou null.
function nearestRes(i: number): number | null {
  let best = Infinity
  for (let s = 0; s < swingHi.length; s++) {
    const sh = swingHi[s]!
    if (sh + L > i) break // pas encore confirmée (no-lookahead)
    if (i - sh > W) continue // trop ancienne
    const r = high[sh]!
    if (r > close[i]! && r < best) best = r
  }
  return best === Infinity ? null : best
}

const f = (v: number, d = 2): string => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '—')
const TOL = 0.015 // « près » d'une résistance = à moins de 1,5 % en dessous
const FAR = 0.04 // « espace libre » = pas de résistance à moins de 4 %
const SLOPE = 30 // bougies pour la pente EMA (régime bear)

// stats forward groupées
interface Acc { n: number; sum: number; neg: number }
const mk = (): Acc => ({ n: 0, sum: 0, neg: 0 })
const add = (a: Acc, r: number): void => {
  a.n++
  a.sum += r
  if (r < 0) a.neg++
}
const show = (label: string, a: Acc): void =>
  console.log(`  ${label.padEnd(30)} n=${String(a.n).padStart(5)}  fwd moy ${f(a.sum / Math.max(1, a.n) * 100, 2).padStart(7)}%  %rechute ${((a.neg / Math.max(1, a.n)) * 100).toFixed(0).padStart(3)}%`)

for (const K of [10, 20, 40]) {
  const nearR = mk()
  const farR = mk()
  const allBear = mk()
  for (let i = SLOPE; i < n - K; i++) {
    // régime bear : EMA50 en déclin (le contexte où la strat est short)
    const bear = ema50[i]! < ema50[i - SLOPE]!
    if (!bear) continue
    // recroisement EMA par le haut = le signal de RACHAT de la strat
    const recross = close[i]! > ema50[i]! && close[i - 1]! <= ema50[i - 1]!
    if (!recross) continue
    const fwd = close[i + K]! / close[i]! - 1 // >0 = rebond confirmé (rachat OK) ; <0 = rechute (on aurait dû tenir)
    add(allBear, fwd)
    const r = nearestRes(i)
    const dist = r !== null ? (r - close[i]!) / close[i]! : Infinity
    if (dist <= TOL) add(nearR, fwd)
    else if (dist >= FAR) add(farR, fwd)
  }
  console.log(`\n=== Recroisement EMA-haut en bear, forward ${K} bougies (${(K * 4) / 24} j) ===`)
  console.log(`  (fwd<0 = le prix rechute après le recroisement = on aurait eu RAISON de tenir le short)`)
  show('tous', allBear)
  show('résistance proche (≤1,5%)', nearR)
  show('espace libre (≥4%)', farR)
}
process.exit(0)
