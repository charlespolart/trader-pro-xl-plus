/**
 * Étape 3 — étude de corrélation (réfutation rapide, pas un backtest).
 * Le flux au niveau du TRADE (CVD stratifié par taille) prédit-il le rendement
 * forward AU-DELÀ du taker-flow par bougie qu'on a déjà ?
 *
 *   bun apps/server/src/research/aggflow/corr.ts [start] [end] [barMinutes]
 *   ex: bun apps/server/src/research/aggflow/corr.ts 2024-10-25 2024-11-15 60
 *
 * NB : le 1er run télécharge les aggTrades depuis data.binance.vision (lourd).
 */
import { resolve } from 'node:path'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, {
  dataDir: resolve(import.meta.dir, '../../../../../data'),
  onProgress: (label, done, total) => {
    if (done % 5 === 0 || done === total) process.stderr.write(`\r${label}: ${done}/${total}   `)
  },
})

const MARKET = 'spot' as const
const SYMBOL = 'BTCUSDT'
const startStr = process.argv[2] ?? '2024-10-25'
const endStr = process.argv[3] ?? '2024-11-15'
const barMs = Number(process.argv[4] ?? 60) * 60_000
const START = Date.parse(`${startStr}T00:00:00Z`)
const END = Date.parse(`${endStr}T00:00:00Z`)

// buckets notionnels ($) — retail / mid / baleine
const SMALL = 10_000
const BIG = 100_000

interface Bar {
  open: number
  close: number
  vol: number // base volume total
  buyVol: number // volume du côté acheteur agressif (taker buy)
  delta: number // Σ signed (acheteur agressif +, vendeur agressif −)
  dW: number // delta baleine
  dM: number // delta mid
  dR: number // delta retail
  vW: number // volume baleine (|qty|)
  n: number // nb trades
}

function newBar(): Bar {
  return { open: 0, close: 0, vol: 0, buyVol: 0, delta: 0, dW: 0, dM: 0, dR: 0, vW: 0, n: 0 }
}

const bars = new Map<number, Bar>()
let tradeCount = 0

console.error(`Stream aggTrades ${SYMBOL} ${MARKET} ${startStr}→${endStr} (barres ${barMs / 60000}min)…`)
for await (const batch of provider.getAggTrades(MARKET, SYMBOL, START, END)) {
  for (const t of batch) {
    const idx = Math.floor((t.time - START) / barMs)
    let b = bars.get(idx)
    if (!b) {
      b = newBar()
      b.open = t.price
      bars.set(idx, b)
    }
    b.close = t.price
    b.vol += t.qty
    b.n++
    const buyAggressor = !t.isBuyerMaker // isBuyerMaker=true ⇒ vendeur agressif
    const signed = buyAggressor ? t.qty : -t.qty
    if (buyAggressor) b.buyVol += t.qty
    b.delta += signed
    const notional = t.price * t.qty
    if (notional >= BIG) {
      b.dW += signed
      b.vW += t.qty
    } else if (notional >= SMALL) b.dM += signed
    else b.dR += signed
    tradeCount++
  }
}
process.stderr.write('\n')

// barres ordonnées et contiguës
const idxs = [...bars.keys()].sort((a, b) => a - b)
const series = idxs.map((i) => bars.get(i)!)
const n = series.length
if (n < 30) {
  console.error(`Trop peu de barres (${n}). Élargir la fenêtre.`)
  process.exit(1)
}

// prédicteurs par barre (i) + rendements forward
const close = series.map((b) => b.close)
const flowImb = series.map((b) => (b.vol > 0 ? b.delta / b.vol : 0)) // ≡ 2·takerFlow − 1
const whaleImb = series.map((b) => (b.vol > 0 ? b.dW / b.vol : 0))
const midImb = series.map((b) => (b.vol > 0 ? b.dM / b.vol : 0))
const retailImb = series.map((b) => (b.vol > 0 ? b.dR / b.vol : 0))
const whaleMinusRetail = series.map((_, i) => whaleImb[i]! - retailImb[i]!)
const ret = series.map((b) => (b.open > 0 ? Math.log(b.close / b.open) : 0)) // rendement contemporain
// divergence (absorption) : part du flux NON expliquée par le mouvement de prix
// de la barre. flux acheteur fort alors que le prix n'a pas monté = absorption.
// (resid est une déclaration de fonction, hoistée — utilisable ici.)
const divergence = resid(flowImb, ret)

const fwd = (k: number): (number | null)[] =>
  close.map((c, i) => (i + k < n ? Math.log(close[i + k]! / c) : null))

// ---- stats
function pearson(x: number[], y: number[]): { r: number; n: number } {
  const pairs: [number, number][] = []
  for (let i = 0; i < x.length; i++) if (Number.isFinite(x[i]!) && Number.isFinite(y[i]!)) pairs.push([x[i]!, y[i]!])
  const m = pairs.length
  if (m < 3) return { r: NaN, n: m }
  let sx = 0, sy = 0
  for (const [a, b] of pairs) { sx += a; sy += b }
  const mx = sx / m, my = sy / m
  let sxy = 0, sxx = 0, syy = 0
  for (const [a, b] of pairs) { const dx = a - mx, dy = b - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy }
  const d = Math.sqrt(sxx * syy)
  return { r: d === 0 ? 0 : sxy / d, n: m }
}
// résidu de y régressé sur z (OLS simple)
function resid(y: number[], z: number[]): number[] {
  const { r } = pearson(y, z)
  let sz = 0, szz = 0, sy = 0
  for (let i = 0; i < y.length; i++) { sz += z[i]!; szz += z[i]! * z[i]!; sy += y[i]! }
  const mz = sz / y.length, my = sy / y.length
  let cov = 0
  for (let i = 0; i < y.length; i++) cov += (y[i]! - my) * (z[i]! - mz)
  const varz = szz - y.length * mz * mz
  const slope = varz === 0 ? 0 : cov / varz
  const intercept = my - slope * mz
  void r
  return y.map((v, i) => v - (intercept + slope * z[i]!))
}
// corrélation partielle de x et y en contrôlant z
function partial(x: number[], y: number[], z: number[], mask: boolean[]): { r: number; n: number } {
  const xf: number[] = [], yf: number[] = [], zf: number[] = []
  for (let i = 0; i < x.length; i++) if (mask[i]) { xf.push(x[i]!); yf.push(y[i]!); zf.push(z[i]!) }
  return pearson(resid(xf, zf), resid(yf, zf))
}
const star = (r: number, m: number): string => {
  const t = Math.abs(r) * Math.sqrt((m - 2) / (1 - r * r))
  return t > 2.58 ? '***' : t > 1.96 ? '**' : t > 1.64 ? '*' : ''
}
const f = (r: number): string => (Number.isFinite(r) ? (r >= 0 ? '+' : '') + r.toFixed(3) : '—')

// fraction de volume par bucket (sanity)
let vTot = 0, vW = 0
for (const b of series) { vTot += b.vol; vW += b.vW }

console.log(`\n=== Étude de corrélation flux aggTrades — ${SYMBOL} ${MARKET}, ${startStr}→${endStr}, barres ${barMs / 60000}min ===`)
console.log(`${tradeCount.toLocaleString()} trades · ${n} barres · part du volume baleine (>${BIG / 1000}k$) : ${((vW / vTot) * 100).toFixed(1)}%`)
console.log(`Sanity — corr(flux net, rendement contemporain) = ${f(pearson(flowImb, ret).r)} (doit être nettement > 0)\n`)

console.log('Corrélation prédicteur(barre i) → rendement forward. * p<.10  ** p<.05  *** p<.01')
console.log('prédicteur'.padEnd(34) + ['fwd+1', 'fwd+4', 'fwd+12'].map((s) => s.padStart(12)).join(''))
const horizons = [1, 4, 12]
const preds: [string, number[]][] = [
  ['flux NET /vol (= notre takerFlow)', flowImb],
  ['flux BALEINE /vol', whaleImb],
  ['flux MID /vol', midImb],
  ['flux RETAIL /vol', retailImb],
  ['baleine − retail', whaleMinusRetail],
  ['DIVERGENCE flux⊥prix (absorption)', divergence],
]
for (const [label, x] of preds) {
  const cells = horizons.map((k) => {
    const y = fwd(k)
    const xs: number[] = [], ys: number[] = []
    for (let i = 0; i < n; i++) if (y[i] !== null) { xs.push(x[i]!); ys.push(y[i]!) }
    const { r, n: m } = pearson(xs, ys)
    return `${f(r)}${star(r, m)}`.padStart(12)
  })
  console.log(label.padEnd(34) + cells.join(''))
}

console.log('\n>>> LA question : flux BALEINE prédit-il AU-DELÀ du flux net agrégé ? (corr partielle | flux net)')
console.log('prédicteur (| flux net)'.padEnd(34) + ['fwd+1', 'fwd+4', 'fwd+12'].map((s) => s.padStart(12)).join(''))
for (const [label, x] of [['flux BALEINE | flux net', whaleImb], ['baleine−retail | flux net', whaleMinusRetail]] as [string, number[]][]) {
  const cells = horizons.map((k) => {
    const y = fwd(k)
    const mask = y.map((v) => v !== null)
    const yv = y.map((v) => v ?? 0)
    const { r, n: m } = partial(x, yv, flowImb, mask)
    return `${f(r)}${star(r, m)}`.padStart(12)
  })
  console.log(label.padEnd(34) + cells.join(''))
}
console.log('\n(in-sample, fenêtre unique — test de réfutation rapide, PAS une validation)')
process.exit(0)
