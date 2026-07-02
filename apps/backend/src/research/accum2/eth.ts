/**
 * Généralisation : v2 (défauts BTC, AUCUN re-réglage) sur ETHUSDT spot, base.
 * Si la structure de l'edge est réelle, elle doit ~tenir sur un autre actif
 * momentum à bears profonds. (accumulation d'ETH, benchmark = garder ses ETH)
 *   bun apps/backend/src/research/accum2/eth.ts
 */
import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import accumV2 from '../../../../../strategies/btc-accumulator'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../../data') })

function cfg(start: number, end: number): BacktestConfig {
  return {
    strategyId: 'btc-accumulator-v2', params: {} as ParamValues, market: 'spot', symbol: 'ETHUSDT', start, end,
    initialBalance: 1, denomination: 'base', leverage: 1,
    fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
    fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
    fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
  }
}
const f = (v: number, d = 1): string => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '—')

for (const [label, a, b] of [
  ['bear2018', '2018-05-01', '2019-01-01'],
  ['2019→2026', '2019-01-01', '2026-06-13'],
  ['2020-08→2026', '2020-08-01', '2026-06-09'],
  ['bear22', '2021-11-01', '2023-01-01'],
  ['oos 2024→2026', '2024-01-01', '2026-07-01'],
  ['full 2018→2026', '2018-04-05', '2026-07-01'],
] as const) {
  const start = Date.parse(`${a}T00:00:00Z`)
  const end = Date.parse(`${b}T00:00:00Z`)
  const res = await runBacktest({ config: cfg(start, end), def: accumV2, provider })
  const m = res.metrics
  const cs = await provider.getCandles('spot', 'ETHUSDT', '1d', start, end)
  const px = cs.length > 1 ? ((cs[cs.length - 1]!.close - cs[0]!.close) / cs[0]!.close) * 100 : 0
  console.log(
    `${label.padEnd(16)} ETH+ ${f(m.netProfitPct).padStart(7)}%  DD ${f(-m.maxDrawdownPct, 0).padStart(4)}%  ${String(m.totalTrades).padStart(3)}tr  WR ${f(m.winRate, 0)}%  PF ${f(m.profitFactor ?? 0, 2)}  (prix ${f(px, 0)}%)` +
      (res.haltedReason ? ` ⚠ ${res.haltedReason}` : ''),
  )
}
process.exit(0)
