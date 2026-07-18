/**
 * audit1/A5 — test de l'hypothèse « écart = arrondis symbolInfo ».
 * Rejoue les fenêtres baselines avec symbolInfo ÉPINGLÉ aux filtres Binance
 * spot (tickSize 0,01 / stepSize 1e-5 / minNotional 5) au lieu du exchangeInfo
 * live (géo-bloqué FR au moment de l'audit → arrondis absents des re-runs).
 *   DATABASE_URL=postgres://tpx:tpx@localhost:5438/tpx bun apps/backend/src/research/audit1/baseline_pinned.ts
 */
import { resolve } from 'node:path'
import { runBacktest, type BacktestDataProvider, type StrategyDefinition } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues, type SymbolInfo } from '@tpx/shared'
import btcAccum from '../../../../../strategies/btc-accumulator'
import ethAccum from '../../../../../strategies/eth-accumulator'
import btcVrx from '../../../../../strategies/btc-vrx'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5438/tpx')
const base = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../../data'), autoEnsure: false })

const pin = (symbol: string): SymbolInfo => ({
  market: 'spot', symbol,
  baseAsset: symbol.replace('USDT', ''), quoteAsset: 'USDT',
  tickSize: 0.01, stepSize: 0.00001, minQty: 0.00001, minNotional: 5,
  pricePrecision: 2, qtyPrecision: 8, status: 'TRADING',
})
const provider: BacktestDataProvider = {
  getCandles: (m, s, i, a, b) => base.getCandles(m, s, i, a, b),
  getFundingRates: (s, a, b) => base.getFundingRates(s, a, b),
  getSymbolInfo: async (_m, s) => pin(s),
}

function cfg(strategyId: string, symbol: string, start: string, end: string): BacktestConfig {
  return {
    strategyId, params: {} as ParamValues, market: 'spot', symbol,
    start: Date.parse(`${start}T00:00:00Z`), end: Date.parse(`${end}T00:00:00Z`),
    initialBalance: 1, denomination: 'base', leverage: 1,
    fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
    fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
    fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
  }
}

const RUNS: Array<[string, StrategyDefinition, string, string, string, number]> = [
  ['BTC 2019→2026', btcAccum, 'BTCUSDT', '2019-01-01', '2026-06-13', 61.9],
  ['BTC 2020-08→2026', btcAccum, 'BTCUSDT', '2020-08-01', '2026-06-09', 112.5],
  ['BTC full 2018→2026', btcAccum, 'BTCUSDT', '2018-04-05', '2026-07-01', 126.2],
  ['ETH IS 2018→2024', ethAccum, 'ETHUSDT', '2018-04-05', '2024-01-01', 436],
  ['ETH holdout 2024→2026', ethAccum, 'ETHUSDT', '2024-01-01', '2026-07-01', 14.2],
  ['VRX IS 2018→2024', btcVrx, 'BTCUSDT', '2018-04-05', '2024-01-01', 243.7],
]

for (const [label, def, symbol, start, end, expected] of RUNS) {
  const id = def === btcAccum ? 'btc-accumulator' : def === btcVrx ? 'btc-vrx' : 'eth-accumulator'
  const res = await runBacktest({ config: cfg(id, symbol, start, end), def, provider })
  const m = res.metrics
  const d = m.netProfitPct - expected
  console.log(
    `${label.padEnd(24)} net ${m.netProfitPct.toFixed(2).padStart(8)}% (attendu ${expected}) Δ ${d >= 0 ? '+' : ''}${d.toFixed(2)} | DD ${m.maxDrawdownPct.toFixed(2)}% | ${m.totalTrades}tr`,
  )
}
process.exit(0)
