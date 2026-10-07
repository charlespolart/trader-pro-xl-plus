/** revalid1/A3 — H5 lead-lag au grain 4h (test de SÉPARATION, pas un backtest — LOG §1.2) :
 *   (a) BTC→ETH : IC(r_BTC[t], r_ETH[t+1]) et IC(r_ETH[t], r_BTC[t+1]) ; spread Q5−Q1 du retour
 *       suivant conditionné au retour courant de l'autre actif ;
 *   (b) spot→perp BTC : basis_t = perp/spot − 1 (close 4h) → IC(basis_t, r_spot[t+1]) et
 *       IC(r_perp−r_spot [t], r_spot[t+1]).
 *   Barre pré-enregistrée : |IC| médian (rolling 1 an) < 0,05 OU spread < 2 × coûts (2×0,30 % A/R
 *   taker = 0,60 %) → stop. IS 2020→2024-01 ; OOS 2024→ jamais regardé si la barre IS échoue.
 *    DATABASE_URL=postgres://tpx:tpx@localhost:5438/tpx bun apps/backend/src/research/revalid1/a3_leadlag.ts */
import { resolve } from 'node:path'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5438/tpx')
const p = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../../data'), autoEnsure: false })
const S = Date.UTC(2020, 0, 1), E = Date.UTC(2024, 0, 1)
const closes = async (m: 'spot' | 'futures', s: string) => new Map((await p.getCandles(m, s, '4h', S, E)).map((c) => [c.openTime, c.close]))
const bs = await closes('spot', 'BTCUSDT'), es = await closes('spot', 'ETHUSDT'), bp = await closes('futures', 'BTCUSDT')
const ts = [...bs.keys()].filter((t) => es.has(t) && bp.has(t)).sort((a, b) => a - b)
const r = (m: Map<number, number>) => ts.slice(1).map((t, i) => m.get(t)! / m.get(ts[i]!)! - 1)
const rB = r(bs), rE = r(es), rP = r(bp)
const basis = ts.slice(1).map((t) => bp.get(t)! / bs.get(t)! - 1)
const n = rB.length
console.log(`4h 2020→2024 : ${n} barres communes spot/perp`)

function corr(x: number[], y: number[]): number {
  const m = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length
  const mx = m(x), my = m(y)
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < x.length; i++) { sxy += (x[i]! - mx) * (y[i]! - my); sxx += (x[i]! - mx) ** 2; syy += (y[i]! - my) ** 2 }
  return sxy / Math.sqrt(sxx * syy)
}
function rank(x: number[]): number[] { const idx = x.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]); const out = new Array(x.length); idx.forEach(([, i], k) => (out[i] = k)); return out }
const ic = (x: number[], y: number[]) => corr(rank(x), rank(y)) // Spearman
/** IC médian sur fenêtres glissantes d'1 an (2190 barres 4h) */
function rollingIcMedian(x: number[], y: number[]): number {
  const W = 2190, v: number[] = []
  for (let i = 0; i + W <= x.length; i += 365) v.push(ic(x.slice(i, i + W), y.slice(i, i + W)))
  v.sort((a, b) => a - b); return v[Math.floor(v.length / 2)]!
}
/** spread Q5−Q1 du retour suivant (en %) conditionné au signal */
function spread(sig: number[], nxt: number[]): number {
  const idx = sig.map((v, i) => i).sort((a, b) => sig[a]! - sig[b]!)
  const q = Math.floor(idx.length / 5)
  const m = (ids: number[]) => ids.reduce((s, i) => s + nxt[i]!, 0) / ids.length
  return 100 * (m(idx.slice(-q)) - m(idx.slice(0, q)))
}
const lag = (x: number[]) => x.slice(0, -1), lead = (x: number[]) => x.slice(1)
const tests: Array<[string, number[], number[]]> = [
  ['BTC→ETH  (r_BTC[t] → r_ETH[t+1])', lag(rB), lead(rE)],
  ['ETH→BTC  (r_ETH[t] → r_BTC[t+1])', lag(rE), lead(rB)],
  ['BTC auto (r_BTC[t] → r_BTC[t+1])', lag(rB), lead(rB)],
  ['basis→spot (perp/spot−1 [t] → r_spot[t+1])', lag(basis), lead(rB)],
  ['perp−spot→spot (r_perp−r_spot [t] → r_spot[t+1])', lag(rP.map((v, i) => v - rB[i]!)), lead(rB)],
]
const COST2 = 0.60
for (const [label, sig, nxt] of tests) {
  const icAll = ic(sig, nxt), icMed = rollingIcMedian(sig, nxt), sp = spread(sig, nxt)
  const verdict = Math.abs(icMed) < 0.05 || Math.abs(sp) < COST2 ? '⛔ sous la barre' : '⚠ au-dessus → examiner'
  console.log(`${label.padEnd(50)} IC ${icAll.toFixed(3)}  IC médian/an ${icMed.toFixed(3)}  spread Q5−Q1 ${sp.toFixed(2)}% (barre 2×coûts ${COST2}%)  ${verdict}`)
}
process.exit(0)
