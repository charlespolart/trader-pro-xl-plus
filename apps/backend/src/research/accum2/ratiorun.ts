/**
 * Ratio-trend ETHBTC au moteur : parité IS avec la mini-sim python, voisinage,
 * puis HOLDOUT (2024-01→2026-07) — à ne lancer qu'une fois le candidat figé.
 *   bun apps/backend/src/research/accum2/ratiorun.ts [--holdout]
 */
import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import { ratioTrend } from './ratiotrend'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../../data') })

function cfg(params: ParamValues, a: string, b: string): BacktestConfig {
  return {
    strategyId: 'ratio-trend', params, market: 'spot', symbol: 'ETHBTC',
    start: Date.parse(`${a}T00:00:00Z`), end: Date.parse(`${b}T00:00:00Z`),
    initialBalance: 1, denomination: 'quote', leverage: 1,
    fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
    fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
    fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 150,
  }
}
const f = (v: number, d = 1): string => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '—')

async function run(label: string, params: ParamValues, a: string, b: string): Promise<void> {
  const res = await runBacktest({ config: cfg(params, a, b), def: ratioTrend, provider })
  const m = res.metrics
  console.log(
    `${label.padEnd(24)} ${f(m.netProfitPct).padStart(8)}% BTC  DD ${f(-m.maxDrawdownPct, 0).padStart(4)}%  ${String(m.totalTrades).padStart(3)}tr  WR ${f(m.winRate, 0)}%  PF ${f(m.profitFactor ?? 0, 2)}  (B&H ratio ${f(m.buyHoldReturnPct, 0)}%)` +
      (res.haltedReason ? ` ⚠ ${res.haltedReason}` : ''),
  )
}

const holdout = process.argv.includes('--holdout')
if (!holdout) {
  console.log('=== IS 2018-04→2024-01 (parité mini-sim : donchian 15/5 ≈ +391%, DD 29%) ===')
  for (const [N, M] of [[15, 5], [10, 5], [20, 5], [15, 10], [20, 10]] as const) {
    await run(`donchian ${N}/${M}`, { entryLen: N, exitLen: M }, '2018-04-05', '2024-01-01')
  }
} else {
  console.log('=== HOLDOUT 2024-01→2026-07 (tir unique, candidat figé 15/5 + voisins pour contexte) ===')
  for (const [N, M] of [[15, 5], [10, 5], [20, 5]] as const) {
    await run(`donchian ${N}/${M}`, { entryLen: N, exitLen: M }, '2024-01-01', '2026-07-01')
  }
  console.log('\n=== et la période complète 2018-04→2026-07 pour le tableau final ===')
  await run('donchian 15/5 (full)', { entryLen: 15, exitLen: 5 }, '2018-04-05', '2026-07-01')
}
process.exit(0)
