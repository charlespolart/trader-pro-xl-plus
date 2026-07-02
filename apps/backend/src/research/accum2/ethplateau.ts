/**
 * Accumulateur d'ETH (v2 sur ETHUSDT, dénomination base=ETH) avec SES params :
 * grille GROSSIÈRE sur l'IS 2018-04→2024-01 (holdout intouché). Exigence :
 * un PLATEAU positif, pas une case. Rappel : params BTC → -33% sur 2019-2026.
 *   bun apps/backend/src/research/accum2/ethplateau.ts
 */
import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import accumV2 from '../../../../../strategies/btc-accumulator'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../../data') })

function cfg(params: ParamValues): BacktestConfig {
  return {
    strategyId: 'btc-accumulator-v2', params, market: 'spot', symbol: 'ETHUSDT',
    start: Date.parse('2018-04-05T00:00:00Z'), end: Date.parse('2024-01-01T00:00:00Z'),
    initialBalance: 1, denomination: 'base', leverage: 1,
    fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
    fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
    fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
  }
}
const f = (v: number, d = 1): string => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '—')

console.log('=== accumulateur ETH, grille grossière IS (ETH+% = ETH accumulé vs garder) ===')
for (const trend of [
  { trendInterval: '3d', trendMaLen: 60, trendSlopeBars: 8 },
  { trendInterval: '3d', trendMaLen: 80, trendSlopeBars: 10 },
  { trendInterval: '1d', trendMaLen: 200, trendSlopeBars: 30 },
  { trendInterval: '1d', trendMaLen: 250, trendSlopeBars: 30 },
] as const) {
  for (const erMin of [0.35, 0.45]) {
    for (const flow of [true, false]) {
      const params: ParamValues = { ...trend, erMin, useFlowFilter: flow }
      const res = await runBacktest({ config: cfg(params), def: accumV2, provider })
      const m = res.metrics
      console.log(
        `${trend.trendInterval}/${trend.trendMaLen}/${trend.trendSlopeBars} er${erMin} flow=${flow ? 'on ' : 'off'}` +
          ` → ${f(m.netProfitPct).padStart(8)}%  DD ${f(-m.maxDrawdownPct, 0).padStart(4)}%  ${String(m.totalTrades).padStart(3)}tr  PF ${f(m.profitFactor ?? 0, 2)}`,
      )
    }
  }
}
process.exit(0)
