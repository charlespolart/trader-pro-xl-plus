/** revalid1/1.1 — les 3 stratégies live sur la fenêtre VIERGE 2026-07-01→
 *  2026-10-07 (jamais vue), + full et OOS étendus. Mesure pure, 0 réglage.
 *    DATABASE_URL=postgres://tpx:tpx@localhost:5438/tpx bun apps/backend/src/research/revalid1/fresh.ts */
import { resolve } from 'node:path'
import { runBacktest, type StrategyDefinition } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import btcAccum from '../../../../../strategies/btc-accumulator'
import btcVrx from '../../../../../strategies/btc-vrx'
import ethAccum from '../../../../../strategies/eth-accumulator'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5438/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../../data') })
const cfg = (strategyId: string, symbol: string, start: string, end: string): BacktestConfig => ({
  strategyId, params: {} as ParamValues, market: 'spot', symbol,
  start: Date.parse(`${start}T00:00:00Z`), end: Date.parse(`${end}T00:00:00Z`),
  initialBalance: 1, denomination: 'base', leverage: 1,
  fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
  fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
  fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
})
const END = '2026-10-07'
const WINDOWS: Array<[string, string, string]> = [
  ['F0 VIERGE 2026-07→10', '2026-07-01', END],
  ['F2 OOS 2024→2026-10', '2024-01-01', END],
  ['F1 full 2018→2026-10', '2018-04-05', END],
]
const STRATS: Array<[string, StrategyDefinition, string]> = [
  ['btc-accumulator', btcAccum, 'BTCUSDT'],
  ['btc-vrx', btcVrx, 'BTCUSDT'],
  ['eth-accumulator', ethAccum, 'ETHUSDT'],
]
const f = (v: number, d = 1): string => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '—')
for (const [id, def, symbol] of STRATS) {
  for (const [label, start, end] of WINDOWS) {
    const res = await runBacktest({ config: cfg(id, symbol, start, end), def, provider })
    const m = res.metrics
    // prix buy&hold de référence sur la même fenêtre (le benchmark base-denom = 0 %)
    console.log(
      `${id.padEnd(16)} ${label.padEnd(24)} net ${f(m.netProfitPct).padStart(7)}%  DD ${f(-m.maxDrawdownPct).padStart(6)}%  ${String(m.totalTrades).padStart(3)}tr  PF ${f(m.profitFactor ?? 0, 2)}  WR ${f(m.winRate ?? 0, 0)}%` +
        (res.haltedReason ? `  ⚠ ${res.haltedReason}` : ''),
    )
  }
}
process.exit(0)
