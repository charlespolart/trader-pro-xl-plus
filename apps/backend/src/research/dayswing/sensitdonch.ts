/**
 * Vague 2 — sensibilité ENGINE du voisinage donchLen × volMult (entryMode
 * donchian), full période 2019→2026-01. Règle : médiane du voisinage > réf.
 *   bun apps/backend/src/research/dayswing/sensitdonch.ts
 */
import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import swing from '../../../../../strategies/btc-swing'
const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../data') })
const cfg = (params: ParamValues): BacktestConfig => ({
  strategyId: 'btc-swing', params, market: 'spot', symbol: 'BTCUSDT',
  start: Date.parse('2019-01-01T00:00:00Z'), end: Date.parse('2026-01-01T00:00:00Z'),
  initialBalance: 10_000, denomination: 'quote', leverage: 1,
  fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
  fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
  fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
})
const nets: number[] = []
console.log('donchLen'.padEnd(10) + ['vol 1,2', 'vol 1,5', 'vol 2,0'].map((s) => s.padStart(20)).join(''))
for (const donchLen of [40, 55, 70]) {
  let row = String(donchLen).padEnd(10)
  for (const volMult of [1.2, 1.5, 2.0]) {
    const res = await runBacktest({ config: cfg({ entryMode: 'donchian', donchLen, volMult } as unknown as ParamValues), def: swing, provider })
    nets.push(res.metrics.netProfitPct)
    row += `${(res.metrics.netProfitPct >= 0 ? '+' : '') + res.metrics.netProfitPct.toFixed(0)}% PF${(res.metrics.profitFactor ?? 0).toFixed(2)} (${res.metrics.totalTrades})`.padStart(20)
  }
  console.log(row)
}
const s = [...nets].sort((a, b) => a - b)
console.log(`\nvoisinage 3×3 : min ${s[0].toFixed(0)}% · médiane ${s[4].toFixed(0)}% · max ${s[8].toFixed(0)}% — réf entry=ema +432,6 %`)
process.exit(0)
