/**
 * Phase 4 — DÉPENSE UNIQUE du holdout (2026-01→2026-07) + stress bear 2018.
 * Stratégie FIGÉE aux défauts (aucun paramètre ne sera modifié après lecture —
 * c'est le contrat du protocole, LOG.md §3). À ne lancer qu'UNE fois.
 *   bun apps/backend/src/research/dayswing/holdout.ts
 */
import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import swing from '../../../../../strategies/btc-swing'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../data') })

function cfg(start: string, end: string): BacktestConfig {
  return {
    strategyId: 'btc-swing', params: {} as ParamValues, market: 'spot', symbol: 'BTCUSDT',
    start: Date.parse(`${start}T00:00:00Z`), end: Date.parse(`${end}T00:00:00Z`),
    initialBalance: 10_000, denomination: 'quote', leverage: 1,
    fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
    fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
    fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
  }
}
const f = (v: number, d = 1): string => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '—')

for (const [label, start, end] of [
  ['stress bear 2018 (structurel)', '2018-05-01', '2019-01-01'],
  ['HOLDOUT 2026-01→2026-07 (dépense unique)', '2026-01-01', '2026-07-01'],
] as const) {
  const res = await runBacktest({ config: cfg(start, end), def: swing, provider })
  const m = res.metrics
  console.log(
    `${label.padEnd(42)} net ${f(m.netProfitPct).padStart(7)}%  PF ${(m.profitFactor ?? NaN).toFixed(2)}  ` +
      `WR ${m.winRate.toFixed(0)}%  tr ${String(m.totalTrades).padStart(3)}  DD ${f(m.maxDrawdownPct)}%  ` +
      `B&H ${f(m.buyHoldReturnPct)}%` + (res.haltedReason ? `  ⚠ ${res.haltedReason}` : ''),
  )
}
process.exit(0)
