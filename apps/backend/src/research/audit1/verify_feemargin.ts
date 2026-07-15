import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import accumV2 from '../../../../../strategies/btc-accumulator'
const db = createDb('postgres://tpx:tpx@localhost:5438/tpx')
const provider = new PgDataProvider(db, { dataDir: '/tmp', autoEnsure: false })
const config: BacktestConfig = {
  strategyId: 'btc-accumulator-v2', params: { feeMargin: 1.0 } as ParamValues, market: 'spot', symbol: 'BTCUSDT',
  start: Date.parse('2019-01-01T00:00:00Z'), end: Date.parse('2026-06-13T00:00:00Z'),
  initialBalance: 1, denomination: 'base', leverage: 1,
  fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
  fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
  fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
}
const res = await runBacktest({ config, def: accumV2, provider })
console.log(`feeMargin=0.995 : net ${res.metrics.netProfitPct.toFixed(2)}% DD ${res.metrics.maxDrawdownPct.toFixed(2)}% ${res.metrics.totalTrades}tr (attendu baseline juillet : +61.9 / 29.6 / 57)`)
process.exit(0)
