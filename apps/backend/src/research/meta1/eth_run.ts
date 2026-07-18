/** meta1 — équité quotidienne eth-accumulator (moteur réel, défauts
 *  committés, coûts OKX, symbolInfo épinglé — même pattern que
 *  regime1/incumbents_run.ts). Dump incumbent_eth.csv (time,equity).
 *    bun eth_run.ts */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runBacktest, type BacktestDataProvider } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues, type SymbolInfo } from '@tpx/shared'
import ethAccum from '../../../../../strategies/eth-accumulator'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5438/tpx')
const base = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../../data'), autoEnsure: false })
const PINNED: SymbolInfo = {
  market: 'spot', symbol: 'ETHUSDT', baseAsset: 'ETH', quoteAsset: 'USDT',
  tickSize: 0.01, stepSize: 0.0001, minQty: 0.0001, minNotional: 5,
  pricePrecision: 2, qtyPrecision: 8, status: 'TRADING',
}
const provider: BacktestDataProvider = {
  getCandles: (m, s, i, a, b) => base.getCandles(m, s, i, a, b),
  getFundingRates: (s, a, b) => base.getFundingRates(s, a, b),
  getSymbolInfo: async () => PINNED,
}

const config: BacktestConfig = {
  strategyId: ethAccum.name, params: {} as ParamValues, market: 'spot', symbol: 'ETHUSDT',
  start: Date.parse('2020-07-01T00:00:00Z'), end: Date.parse('2026-07-01T00:00:00Z'),
  initialBalance: 1, denomination: 'base', leverage: 1,
  fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
  fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
  fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
}

const res = await runBacktest({ config, def: ethAccum, provider })
const eq = res.equity.map((e) => `${e.time},${e.equity}`).join('\n')
writeFileSync(resolve(import.meta.dir, 'incumbent_eth.csv'), `time,equity\n${eq}\n`)
console.log(`eth (base) : équité ${res.equity.length} pts, ${res.trades.length} trades, ` +
  `final ${res.metrics.finalEquity.toFixed(4)} ETH, halted=${res.haltedReason ?? 'non'}`)
process.exit(0)
