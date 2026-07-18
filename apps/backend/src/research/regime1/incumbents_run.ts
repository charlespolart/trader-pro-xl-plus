/** regime1 étape 7a — séries d'équité quotidiennes des incumbents via le
 *  VRAI moteur (défauts committés, coûts OKX taker 0,10 % + slip 0,05 %,
 *  symbolInfo épinglé — exchangeInfo géo-bloqué sans effet, cf. audit1/A5).
 *  Dump CSV : incumbent_<nom>.csv (time,equity) + _trades.csv (entry,exit).
 *    DATABASE_URL=postgres://tpx:tpx@localhost:5438/tpx bun incumbents_run.ts */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runBacktest, type BacktestDataProvider, type StrategyDefinition } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues, type SymbolInfo } from '@tpx/shared'
import btcAccum from '../../../../../strategies/btc-accumulator'
import btcSwing from '../../../../../strategies/btc-swing'
import btcVrx from '../../../../../strategies/btc-vrx'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5438/tpx')
const base = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../../data'), autoEnsure: false })
const PINNED: SymbolInfo = {
  market: 'spot', symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT',
  tickSize: 0.01, stepSize: 0.00001, minQty: 0.00001, minNotional: 5,
  pricePrecision: 2, qtyPrecision: 8, status: 'TRADING',
}
const provider: BacktestDataProvider = {
  getCandles: (m, s, i, a, b) => base.getCandles(m, s, i, a, b),
  getFundingRates: (s, a, b) => base.getFundingRates(s, a, b),
  getSymbolInfo: async () => PINNED,
}

const START = Date.parse('2020-07-01T00:00:00Z')
const END = Date.parse('2026-07-01T00:00:00Z')

function cfg(strategyId: string, denomination: 'base' | 'quote'): BacktestConfig {
  return {
    strategyId, params: {} as ParamValues, market: 'spot', symbol: 'BTCUSDT',
    start: START, end: END,
    initialBalance: denomination === 'base' ? 1 : 10_000, denomination, leverage: 1,
    fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
    fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
    fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
  }
}

const RUNS: Array<[string, StrategyDefinition, 'base' | 'quote']> = [
  ['swing', btcSwing, 'quote'],
  ['accum', btcAccum, 'base'],
  ['vrx', btcVrx, 'base'],
]

for (const [name, def, denom] of RUNS) {
  const res = await runBacktest({ config: cfg(def.name, denom), def, provider })
  const eq = res.equity.map((e) => `${e.time},${e.equity}`).join('\n')
  writeFileSync(resolve(import.meta.dir, `incumbent_${name}.csv`), `time,equity\n${eq}\n`)
  const tr = res.trades
    .map((t) => `${t.entryTime},${t.exitTime ?? ''},${t.direction}`)
    .join('\n')
  writeFileSync(resolve(import.meta.dir, `incumbent_${name}_trades.csv`), `entryTime,exitTime,direction\n${tr}\n`)
  console.log(
    `${name} (${denom}) : équité ${res.equity.length} pts, ${res.trades.length} trades, ` +
    `final ${res.metrics.finalEquity.toFixed(denom === 'base' ? 4 : 0)}, halted=${res.haltedReason ?? 'non'}`,
  )
}
process.exit(0)
