/** revalid1/A1 — H14 vol-target / allocation dynamique du duo accum+vrx (pré-enregistré LOG §1.2).
 *  Post-traitement des equity curves du moteur réel (pas de re-backtest) :
 *   - duo fixe 50/50 = référence ;
 *   - VT : w_t = min(1, σ_cible/σ_réalisée(fenêtre)) sur le duo, reste en « hold » (1 BTC) ;
 *     coût 0,15 % × |Δw| (bascule virtuelle) ; grille FIGÉE σ∈{30,40,50 %} × fen∈{20,40,60 j} ;
 *   - RG : poids régime — bull (EMA200 1d montante ET prix > EMA200) → vrx seul ; sinon 50/50 ;
 *   - null : rendements journaliers du duo permutés par blocs de 30 j (500 tirages), même règle VT
 *     → distribution du gain de Calmar « sur séquence détruite » ; barre : Calmar > duo fixe sur
 *     IS ET OOS, et percentile ≥ 95 du null.
 *    DATABASE_URL=postgres://tpx:tpx@localhost:5438/tpx bun apps/backend/src/research/revalid1/a1_voltarget.ts */
import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import btcAccum from '../../../../../strategies/btc-accumulator'
import btcVrx from '../../../../../strategies/btc-vrx'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5438/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../../data') })
const cfg = (strategyId: string, start: string, end: string): BacktestConfig => ({
  strategyId, params: {} as ParamValues, market: 'spot', symbol: 'BTCUSDT',
  start: Date.parse(`${start}T00:00:00Z`), end: Date.parse(`${end}T00:00:00Z`),
  initialBalance: 1, denomination: 'base', leverage: 1,
  fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
  fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
  fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
})
const DAY = 86_400_000
const COST = 0.0015

/** equity 4h → clôtures journalières (dernier point de chaque jour UTC) */
function daily(eq: Array<{ time: number; equity: number }>): Map<number, number> {
  const m = new Map<number, number>()
  for (const p of eq) m.set(Math.floor(p.time / DAY) * DAY, p.equity)
  return m
}
function stats(e: number[], days: number): { cagr: number; dd: number; calmar: number } {
  let peak = -Infinity, dd = 0
  for (const v of e) { peak = Math.max(peak, v); dd = Math.min(dd, (v - peak) / peak) }
  const cagr = (e[e.length - 1]! / e[0]!) ** (365 / days) - 1
  return { cagr: cagr * 100, dd: dd * 100, calmar: dd < 0 ? cagr / -dd : NaN }
}
/** applique une suite de poids w_t (exposition au duo, reste en hold) sur des rendements journaliers */
function apply(r: number[], w: number[]): number[] {
  const e = [1]
  for (let i = 0; i < r.length; i++) {
    const dw = i === 0 ? w[0]! : Math.abs(w[i]! - w[i - 1]!)
    e.push(e[i]! * (1 + w[i]! * r[i]! - COST * dw))
  }
  return e
}
function volTarget(r: number[], target: number, win: number): number[] {
  const w: number[] = []
  for (let i = 0; i < r.length; i++) {
    if (i < win) { w.push(1); continue }
    let s = 0, s2 = 0
    for (let j = i - win; j < i; j++) { s += r[j]!; s2 += r[j]! * r[j]! }
    const sd = Math.sqrt(Math.max(0, s2 / win - (s / win) ** 2)) * Math.sqrt(365)
    w.push(sd > 0 ? Math.min(1, target / sd) : 1)
  }
  return w
}
/** permutation par blocs de 30 j (séquence détruite, distribution conservée) */
function blockPermute(r: number[], rng: () => number): number[] {
  const B = 30
  const blocks: number[][] = []
  for (let i = 0; i < r.length; i += B) blocks.push(r.slice(i, i + B))
  for (let i = blocks.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [blocks[i], blocks[j]] = [blocks[j]!, blocks[i]!] }
  return blocks.flat()
}
function mulberry32(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const f = (v: number, d = 1): string => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '—')

for (const [label, start, end] of [['IS  2018-04→2024-01', '2018-04-05', '2024-01-01'], ['OOS 2024-01→2026-10', '2024-01-01', '2026-10-07']] as const) {
  const a = await runBacktest({ config: cfg('btc-accumulator', start, end), def: btcAccum, provider })
  const b = await runBacktest({ config: cfg('btc-vrx', start, end), def: btcVrx, provider })
  const da = daily(a.equity), dbb = daily(b.equity)
  const days = [...da.keys()].filter((t) => dbb.has(t)).sort((x, y) => x - y)
  const ea = days.map((t) => da.get(t)!), eb = days.map((t) => dbb.get(t)!)
  const duo = days.map((_, i) => 0.5 * ea[i]! / ea[0]! + 0.5 * eb[i]! / eb[0]!)
  const r = duo.slice(1).map((v, i) => v / duo[i]! - 1)
  const ra = ea.slice(1).map((v, i) => v / ea[i]! - 1), rb = eb.slice(1).map((v, i) => v / eb[i]! - 1)
  const n = r.length
  const base = stats(duo, n)
  console.log(`\n${label} — duo fixe 50/50 : CAGR ${f(base.cagr)}% DD ${f(base.dd)}% Calmar ${f(base.calmar, 2)}`)
  // ---- VT grille
  const rng = mulberry32(42)
  const nulls = Array.from({ length: 500 }, () => blockPermute(r, rng))
  for (const target of [0.30, 0.40, 0.50]) for (const win of [20, 40, 60]) {
    const w = volTarget(r, target, win)
    const s = stats(apply(r, w), n)
    const gain = s.calmar - base.calmar
    let beat = 0
    for (const rn of nulls) { const wn = volTarget(rn, target, win); const sn = stats(apply(rn, wn), n); const bn = stats([1, ...rn.reduce<number[]>((acc, x) => { acc.push((acc[acc.length - 1] ?? 1) * (1 + x)); return acc }, [])], n); if (sn.calmar - bn.calmar >= gain) beat++ }
    const pct = 100 * (1 - beat / nulls.length)
    console.log(`  VT σ${(target * 100).toFixed(0)}/${win}j : CAGR ${f(s.cagr)}% DD ${f(s.dd)}% Calmar ${f(s.calmar, 2)} (Δ ${f(gain, 2)}) · expo moy ${(w.reduce((x, y) => x + y, 0) / w.length).toFixed(2)} · pct null ${pct.toFixed(0)}`)
  }
  // ---- RG régime : EMA200 1d montante ET prix > EMA200 → vrx seul, sinon 50/50
  const c1d = await provider.getCandles('spot', 'BTCUSDT', '1d', Date.parse(`${start}T00:00:00Z`) - 400 * DAY, Date.parse(`${end}T00:00:00Z`))
  const ema = new Map<number, { e: number; up: boolean; px: number }>()
  let e = c1d[0]!.close, prev = e
  const k = 2 / 201
  const hist: number[] = []
  for (const c of c1d) { prev = e; e = e + k * (c.close - e); hist.push(e); const e30 = hist[hist.length - 31] ?? e; ema.set(c.openTime, { e, up: e > e30, px: c.close }) }
  const wA: number[] = [], wB: number[] = []
  for (let i = 1; i < days.length; i++) { const g = ema.get(days[i - 1]!); const bull = g ? g.up && g.px > g.e : false; wA.push(bull ? 0 : 0.5); wB.push(bull ? 1 : 0.5) }
  const rg = [1]
  for (let i = 0; i < n; i++) { const dw = i === 0 ? 0 : Math.abs(wA[i]! - wA[i - 1]!) + Math.abs(wB[i]! - wB[i - 1]!); rg.push(rg[i]! * (1 + wA[i]! * ra[i]! + wB[i]! * rb[i]! - COST * dw)) }
  const srg = stats(rg, n)
  console.log(`  RG bull→vrx seul / sinon 50-50 : CAGR ${f(srg.cagr)}% DD ${f(srg.dd)}% Calmar ${f(srg.calmar, 2)} (Δ ${f(srg.calmar - base.calmar, 2)}) · jours bull ${(100 * wA.filter((x) => x === 0).length / n).toFixed(0)}%`)
}
process.exit(0)
