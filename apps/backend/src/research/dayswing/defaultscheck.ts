/**
 * Vague 2 — contrôle des NOUVEAUX défauts (entryMode=donchian, D21) :
 * full 2019→2026-01 (attendu ≈ +474,3 %, 86 tr), année par année, stress bear
 * 2018, holdout 2026-01→07 (attendu 0 trade — 0 barre bull, tout mode).
 *   bun apps/backend/src/research/dayswing/defaultscheck.ts
 */
import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import swing from '../../../../../strategies/btc-swing'
const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../data') })
const cfg = (start: string, end: string): BacktestConfig => ({
  strategyId: 'btc-swing', params: {} as ParamValues, market: 'spot', symbol: 'BTCUSDT',
  start: Date.parse(`${start}T00:00:00Z`), end: Date.parse(`${end}T00:00:00Z`),
  initialBalance: 10_000, denomination: 'quote', leverage: 1,
  fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
  fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
  fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
})
const f = (v: number, d = 1): string => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '—')
async function run(label: string, start: string, end: string): Promise<void> {
  const res = await runBacktest({ config: cfg(start, end), def: swing, provider })
  const m = res.metrics
  console.log(
    label.padEnd(26) + `net ${f(m.netProfitPct).padStart(8)}%  PF ${(m.profitFactor ?? NaN).toFixed(2).padStart(5)}  ` +
      `WR ${m.winRate.toFixed(0).padStart(3)}%  tr ${String(m.totalTrades).padStart(3)}  DD ${f(m.maxDrawdownPct).padStart(6)}%  B&H ${f(m.buyHoldReturnPct).padStart(8)}%` +
      (res.haltedReason ? `  ⚠ ${res.haltedReason}` : ''),
  )
}
await run('FULL 2019→2026-01', '2019-01-01', '2026-01-01')
for (let y = 2019; y <= 2025; y++) await run(String(y), `${y}-01-01`, `${y + 1}-01-01`)
await run('bear 2018 (stress)', '2018-05-01', '2019-01-01')
await run('holdout 2026-01→07', '2026-01-01', '2026-07-01')
process.exit(0)
