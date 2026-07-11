/**
 * Vérification terrain du moteur de pivots sur données réelles (BTCUSDT 4h) :
 * (1) chaque pivot confirmé doit être l'extrême EXACT de sa fenêtre ±L dans la
 * série brute ; (2) affichage de la structure zigzag récente pour contrôle à
 * l'œil (dates/prix des swings connus).
 *   bun apps/backend/src/research/dayswing/pivotcheck.ts [--from=2025-07-01]
 */
import { createDb } from '@tpx/db'
import { CandleStore } from '@tpx/data'
import { fractalPivots, zigzag, type PivotState, type ZigzagState } from '@tpx/core'

const arg = (name: string, dflt: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? dflt
const FROM = Date.parse(arg('from', '2025-07-01') + 'T00:00:00Z')

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const store = new CandleStore(db)
const candles = await store.getCandles('spot', 'BTCUSDT', '4h', FROM, Date.now())
console.log(`${candles.length} bougies 4h depuis ${arg('from', '2025-07-01')}`)

const L = 5
const R = 5
const pInst = fractalPivots(L, R).create()
const zInst = zigzag(L, R, 1.5, 14).create()
let ps: PivotState | null = null
let zs: ZigzagState | null = null
for (const c of candles) {
  ps = pInst.update(c) as PivotState | null
  zs = zInst.update(c) as ZigzagState | null
}

// (1) contrôle exhaustif contre la série brute
let bad = 0
for (const p of ps!.pivots) {
  const i = p.barIndex
  const win = candles.slice(Math.max(0, i - L), i + R + 1)
  const ref = p.kind === 'high' ? Math.max(...win.map((c) => c.high)) : Math.min(...win.map((c) => c.low))
  const ok = p.kind === 'high' ? p.price === ref && candles[i].high === ref : p.price === ref && candles[i].low === ref
  if (!ok) {
    bad++
    console.log(`✗ pivot ${p.kind}@${i} ${p.price} ≠ extrême fenêtre ${ref}`)
  }
}
console.log(`contrôle brut : ${ps!.pivots.length} pivots, ${bad} incohérents`)

// (2) structure zigzag récente
console.log(`\nzigzag(${L},${R},1.5×ATR14) — ${zs!.points.length} points, direction ${zs!.direction} :`)
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 13).replace('T', ' ')
for (const pt of zs!.points.slice(-14)) {
  const structure =
    zs!.points.filter((q) => q.kind === pt.kind && q.barIndex < pt.barIndex).slice(-1).map((prev) =>
      pt.kind === 'high' ? (pt.price > prev.price ? 'HH' : 'LH') : pt.price > prev.price ? 'HL' : 'LL',
    )[0] ?? '--'
  console.log(
    `  ${pt.kind === 'high' ? '▲' : '▼'} ${structure}  ${fmt(pt.openTime)}  ${pt.price.toFixed(0).padStart(7)}  ` +
      `jambe ${pt.legAtrMult.toFixed(1)}×ATR  confirmé ${R * 4}h plus tard`,
  )
}
process.exit(0)
