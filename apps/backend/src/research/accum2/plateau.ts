/**
 * RE-CARTOGRAPHIE DU PLATEAU sur données RÉPARÉES (les défauts v2 3d/60/8 ont
 * été choisis sur des données 3d trouées). IS = 2018-04-05 → 2024-01-01,
 * holdout 2024+ non touché. Confirm figé (1d/200/30) sauf sweep dédié.
 *   bun apps/backend/src/research/accum2/plateau.ts
 */
import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import accumV2 from '../../../../../strategies/btc-accumulator-v2'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../../data') })

const START = Date.parse('2018-04-05T00:00:00Z')
const END = Date.parse('2024-01-01T00:00:00Z')

function cfg(params: ParamValues): BacktestConfig {
  return {
    strategyId: 'btc-accumulator-v2', params, market: 'spot', symbol: 'BTCUSDT', start: START, end: END,
    initialBalance: 1, denomination: 'base', leverage: 1,
    fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
    fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
    fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
  }
}
const f = (v: number, d = 1): string => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '—')

async function run(label: string, params: ParamValues): Promise<void> {
  try {
    const res = await runBacktest({ config: cfg(params), def: accumV2, provider })
    const m = res.metrics
    console.log(
      `${label.padEnd(34)} ${f(m.netProfitPct).padStart(8)}%  DD ${f(-m.maxDrawdownPct, 0).padStart(4)}%  ${String(m.totalTrades).padStart(3)}tr  PF ${f(m.profitFactor ?? 0, 2)}`,
    )
  } catch (err) {
    console.log(`${label} ERREUR: ${err instanceof Error ? err.message : err}`)
  }
}

console.log('=== plateau tendance 3d (trendMaLen × trendSlopeBars) — IS 2018-04→2024-01 ===')
for (const len of [40, 50, 60, 70, 80, 100]) {
  for (const slope of [4, 6, 8, 10, 12]) {
    await run(`3d/${len}/${slope}`, { trendInterval: '3d', trendMaLen: len, trendSlopeBars: slope })
  }
}
console.log('\n=== tendance 1d (équivalents v1) ===')
for (const len of [150, 200, 250]) {
  for (const slope of [20, 30, 45]) {
    await run(`1d/${len}/${slope}`, { trendInterval: '1d', trendMaLen: len, trendSlopeBars: slope })
  }
}
console.log('\n=== tendance 1w ===')
for (const len of [40, 50]) {
  for (const slope of [4, 6]) {
    await run(`1w/${len}/${slope}`, { trendInterval: '1w', trendMaLen: len, trendSlopeBars: slope })
  }
}
console.log('\n=== sweeps 1-D autour des défauts (le reste figé) ===')
for (const v of [0.25, 0.3, 0.35, 0.4, 0.45]) await run(`erMin=${v}`, { erMin: v })
for (const v of [30, 40, 50, 60, 75]) await run(`emaLen=${v}`, { emaLen: v })
for (const v of [40, 50, 60, 75]) await run(`rebuyEmaLen=${v}`, { rebuyEmaLen: v })
for (const v of [3, 4, 5, 6, 8]) await run(`maxLossPct=${v}`, { maxLossPct: v })
for (const v of [2, 2.5, 3, 3.5]) await run(`stopAtrMult=${v}`, { stopAtrMult: v })
await run('useFlowFilter=false', { useFlowFilter: false })
await run('useConfirm=false', { useConfirm: false })
for (const v of [0, 15, 30, 45]) await run(`confirmSlopeBars=${v}`, { confirmSlopeBars: v })
for (const v of [150, 200, 250]) await run(`confirmMaLen=${v}`, { confirmMaLen: v })
process.exit(0)
