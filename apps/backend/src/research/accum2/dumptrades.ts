/**
 * Dump JSON des trades v2 (défauts) pour les tests statistiques offline.
 *   bun apps/backend/src/research/accum2/dumptrades.ts <outfile.json>
 */
import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import accumV2 from '../../../../../strategies/btc-accumulator'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../../data') })

const out = process.argv[2] ?? '/tmp/v2trades.json'
const cfg: BacktestConfig = {
  strategyId: 'btc-accumulator-v2', params: {} as ParamValues, market: 'spot', symbol: 'BTCUSDT',
  start: Date.parse('2018-04-05T00:00:00Z'), end: Date.parse('2026-07-01T00:00:00Z'),
  initialBalance: 1, denomination: 'base', leverage: 1,
  fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
  fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
  fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
}
const res = await runBacktest({ config: cfg, def: accumV2, provider })
const trades = res.trades
  .filter((t) => t.exitTime !== null)
  .map((t) => ({ entry: t.entryTime, exit: t.exitTime, pnlPct: t.realizedPnlPct }))
await Bun.write(out, JSON.stringify({ net: res.metrics.netProfitPct, dd: res.metrics.maxDrawdownPct, trades }, null, 1))
console.log(`écrit ${trades.length} trades → ${out} (net ${res.metrics.netProfitPct.toFixed(2)}%)`)
process.exit(0)
