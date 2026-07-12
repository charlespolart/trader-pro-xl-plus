/**
 * treasury1 : simule les 3 bots LIVE (défauts produit) sur 2020-08→2026-06 et
 * exporte les tranches (TradeRecord) pour l'étude de trésorerie — la fenêtre
 * de cash dormant d'une tranche = [entryTime, exitTime).
 *
 *   bun apps/backend/src/research/treasury1/extract_cash.ts <out.json>
 */
import { resolve } from 'node:path'
import { runBacktest, type StrategyDefinition } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig } from '@tpx/shared'
import btcAccumulator from '../../../../../strategies/btc-accumulator'
import btcVrx from '../../../../../strategies/btc-vrx'
import ethAccumulator from '../../../../../strategies/eth-accumulator'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../../data') })

const START = Date.parse('2020-08-01T00:00:00Z')
const END = Date.parse('2026-06-01T00:00:00Z')

function cfg(def: StrategyDefinition, symbol: string): BacktestConfig {
  return {
    strategyId: def.id,
    params: {},          // défauts produit — mêmes que les bots live
    market: 'spot',
    symbol,
    start: START,
    end: END,
    initialBalance: 1,   // 1 coin
    denomination: 'base',
    leverage: 1,
    fees: { ...DEFAULT_FEES.spot },
    slippagePct: 0.0005,
    fillMode: 'candle',
    intrabarPath: 'heuristic',
    limitFillRatio: 0.25,
    fundingEnabled: false,
    maintenanceMarginRate: 0.005,
    warmupBars: 300,
  }
}

const bots: Array<{ label: string; def: StrategyDefinition; symbol: string; coin: string }> = [
  { label: 'btc-accumulator', def: btcAccumulator, symbol: 'BTCUSDT', coin: 'BTC' },
  { label: 'btc-vrx', def: btcVrx, symbol: 'BTCUSDT', coin: 'BTC' },
  { label: 'eth-accumulator', def: ethAccumulator, symbol: 'ETHUSDT', coin: 'ETH' },
]

const out: Record<string, unknown> = { start: START, end: END }
for (const b of bots) {
  const res = await runBacktest({ config: cfg(b.def, b.symbol), def: b.def, provider })
  const trades = res.trades.map((t) => ({
    entryTime: t.entryTime,
    exitTime: t.exitTime,
    qty: t.qty,
    entryPrice: t.avgEntryPrice,
    exitPrice: t.avgExitPrice,
  }))
  out[b.label] = {
    symbol: b.symbol,
    coin: b.coin,
    trades,
    finalCoin: 1 + res.metrics.netProfitPct / 100,
    netProfitPct: res.metrics.netProfitPct,
    totalTrades: res.metrics.totalTrades,
    halted: res.haltedReason ?? null,
  }
  console.log(`${b.label}: ${res.metrics.totalTrades} tranches, coin final ×${(1 + res.metrics.netProfitPct / 100).toFixed(4)}${res.haltedReason ? ` ⚠ ${res.haltedReason}` : ''}`)
}

await Bun.write(process.argv[2] ?? 'treasury_trades.json', JSON.stringify(out))
console.log(`→ ${process.argv[2] ?? 'treasury_trades.json'}`)
process.exit(0)
