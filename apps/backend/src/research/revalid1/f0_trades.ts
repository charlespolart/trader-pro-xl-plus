/** revalid1/A2 — les trades du backtest sur la fenêtre vierge, à confronter aux
 *  cycles RÉELS des bots live (parité moteur↔réel sur 3 mois, validation gratuite).
 *    DATABASE_URL=postgres://tpx:tpx@localhost:5438/tpx bun apps/backend/src/research/revalid1/f0_trades.ts */
import { resolve } from 'node:path'
import { runBacktest, type StrategyDefinition } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import btcAccum from '../../../../../strategies/btc-accumulator'
import btcVrx from '../../../../../strategies/btc-vrx'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5438/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../../data') })
const cfg = (strategyId: string, start: string, end: string): BacktestConfig => ({
  strategyId, params: {} as ParamValues, market: 'spot', symbol: 'BTCUSDT',
  start: Date.parse(`${start}T00:00:00Z`), end: Date.parse(`${end}T00:00:00Z`),
  initialBalance: 1, denomination: 'base', leverage: 1,
  fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
  fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
  fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
})
const d = (ms: number | undefined) => (ms ? new Date(ms).toISOString().slice(0, 13) : '—')
for (const [id, def] of [['btc-accumulator', btcAccum], ['btc-vrx', btcVrx]] as Array<[string, StrategyDefinition]>) {
  // on démarre plus tôt pour que le warmup/état soit « chaud » au 1er juillet, puis on ne lit que les trades ≥ 07/2026
  const res = await runBacktest({ config: cfg(id, '2025-01-01', '2026-10-07'), def, provider })
  console.log(`=== ${id} — trades (entrée = vente, sortie = rachat) depuis 2026-06-01`)
  for (const t of res.trades) {
    if (t.entryTime < Date.UTC(2026, 5, 1)) continue
    console.log(`  vente ${d(t.entryTime)} @ ${t.avgEntryPrice.toFixed(0)} → rachat ${d(t.exitTime ?? undefined)} @ ${(t.avgExitPrice ?? 0).toFixed(0)}  pnl ${(t.realizedPnlPct).toFixed(2)}%  [${t.exitReason ?? 'ouvert'}]`)
  }
}
process.exit(0)
