/**
 * Double confirmation : la v2 3d/60/8 ne vend que si le 3d ET le journalier
 * (EMA200, déclin 30j) sont baissiers. But : couper les whipsaws des
 * corrections de bull (2019-2020) → réduire le drawdown sans tuer le rendement.
 * Compare useConfirm OFF (3d seul) vs ON (3d+1d) sur plusieurs fenêtres + années.
 *
 *   bun apps/backend/src/research/accumv2confirm.ts
 */
import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import accumV2 from '../../../../strategies/btc-accumulator-v2'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../data') })

function cfg(params: ParamValues, start: number, end: number): BacktestConfig {
  return {
    strategyId: 'btc-accumulator-v2', params, market: 'spot', symbol: 'BTCUSDT', start, end,
    initialBalance: 1, denomination: 'base', leverage: 1,
    fees: { ...DEFAULT_FEES.spot, bnbDiscount: false }, slippagePct: 0.0005,
    fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
    fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
  }
}
const D = (s: string): number => Date.parse(`${s}T00:00:00Z`)
const f = (v: number, d = 1): string => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '—')
const BASE3D: ParamValues = { trendInterval: '3d', trendMaLen: 60, trendSlopeBars: 8 }

async function one(useConfirm: boolean, a: string, b: string) {
  const r = await runBacktest({ config: cfg({ ...BASE3D, useConfirm }, D(a), D(b)), def: accumV2, provider })
  return r.metrics
}

const WINDOWS: [string, string, string][] = [
  ['2019→2026 (la tienne)', '2019-01-01', '2026-06-13'],
  ['2020-08→2026', '2020-08-01', '2026-06-09'],
  ['bear22', '2021-11-01', '2023-01-01'],
  ['chop23', '2023-01-01', '2024-01-01'],
]

console.log('=== Double confirmation 3d+1d : OFF (3d seul) vs ON (3d ET journalier) ===\n')
console.log('fenêtre                    |        OFF (3d seul)        |        ON (3d + 1d)')
console.log('                           |  net%   DD%   tr  expo% |  net%   DD%   tr  expo%')
for (const [label, a, b] of WINDOWS) {
  const off = await one(false, a, b)
  const on = await one(true, a, b)
  const fmt = (m: typeof off): string =>
    `${f(m.netProfitPct).padStart(6)} ${f(-m.maxDrawdownPct).padStart(5)} ${String(m.totalTrades).padStart(4)} ${f(m.exposurePct, 0).padStart(4)}`
  console.log(`${label.padEnd(26)} | ${fmt(off)} | ${fmt(on)}`)
}

console.log('\n=== Année par année (capital 1 BTC remis) — OFF vs ON ===')
console.log('année |   OFF net% / DD%  |   ON net% / DD%')
for (let y = 2019; y <= 2025; y++) {
  const off = await one(false, `${y}-01-01`, `${y + 1}-01-01`)
  const on = await one(true, `${y}-01-01`, `${y + 1}-01-01`)
  console.log(`${y}  |  ${f(off.netProfitPct).padStart(6)} / ${f(-off.maxDrawdownPct).padStart(6)}  |  ${f(on.netProfitPct).padStart(6)} / ${f(-on.maxDrawdownPct).padStart(6)}`)
}
process.exit(0)
