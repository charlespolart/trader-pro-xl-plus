/**
 * PORTEFEUILLE COMBINÉ v2 + VRX (moteur réel, pas d'approximation) :
 * deux bots spot à parts égales, rebalancement virtuel aucun (chaque moitié
 * vit sa vie — c'est exactement ce que ferait un déploiement 2 bots).
 * Fenêtres : IS accum3, OOS 2024→2026, full 2018→2026.
 *   bun apps/backend/src/research/accum3/mix.ts
 */
import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import btcAccum from '../../../../../strategies/btc-accumulator'
import btcVrx from '../../../../../strategies/btc-vrx'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../../data') })

function cfg(strategyId: string, start: string, end: string): BacktestConfig {
  return {
    strategyId, params: {} as ParamValues, market: 'spot', symbol: 'BTCUSDT',
    start: Date.parse(`${start}T00:00:00Z`), end: Date.parse(`${end}T00:00:00Z`),
    initialBalance: 1, denomination: 'base', leverage: 1,
    fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
    fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
    fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
  }
}

function stats(eq: number[]): { net: number; dd: number } {
  let peak = -Infinity
  let dd = 0
  for (const v of eq) {
    peak = Math.max(peak, v)
    dd = Math.min(dd, (v - peak) / peak)
  }
  return { net: (eq[eq.length - 1]! / eq[0]! - 1) * 100, dd: dd * 100 }
}

const f = (v: number): string => (v >= 0 ? '+' : '') + v.toFixed(1)

for (const [label, start, end] of [
  ['IS  2018-04→2024-01', '2018-04-05', '2024-01-01'],
  ['OOS 2024-01→2026-07', '2024-01-01', '2026-07-01'],
  ['FULL 2018-04→2026-07', '2018-04-05', '2026-07-01'],
] as const) {
  const a = await runBacktest({ config: cfg('btc-accumulator', start, end), def: btcAccum, provider })
  const b = await runBacktest({ config: cfg('btc-vrx', start, end), def: btcVrx, provider })
  const ea = new Map(a.equity.map((p) => [p.time, p.equity]))
  const eb = new Map(b.equity.map((p) => [p.time, p.equity]))
  const times = [...ea.keys()].filter((t) => eb.has(t)).sort((x, y) => x - y)
  const va = times.map((t) => ea.get(t)!)
  const vb = times.map((t) => eb.get(t)!)
  const mix = times.map((_, i) => 0.5 * (va[i]! / va[0]!) + 0.5 * (vb[i]! / vb[0]!))
  // corrélation des incréments log (points où au moins un bouge)
  const ra: number[] = []
  const rb: number[] = []
  for (let i = 1; i < times.length; i++) {
    const x = Math.log(va[i]! / va[i - 1]!)
    const y = Math.log(vb[i]! / vb[i - 1]!)
    if (x !== 0 || y !== 0) {
      ra.push(x)
      rb.push(y)
    }
  }
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
  const ma = mean(ra)
  const mb = mean(rb)
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < ra.length; i++) {
    sxy += (ra[i]! - ma) * (rb[i]! - mb)
    sxx += (ra[i]! - ma) ** 2
    syy += (rb[i]! - mb) ** 2
  }
  const corr = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0
  const sa = stats(va)
  const sb = stats(vb)
  const sm = stats(mix)
  console.log(`${label}`)
  console.log(`  v2   ${f(sa.net).padStart(7)}%  DD ${f(sa.dd)}%`)
  console.log(`  vrx  ${f(sb.net).padStart(7)}%  DD ${f(sb.dd)}%`)
  console.log(`  MIX  ${f(sm.net).padStart(7)}%  DD ${f(sm.dd)}%   corr(retours actifs) ${corr.toFixed(2)}`)
}
process.exit(0)
