/**
 * PARITÉ moteur ↔ mini-sim python pour btc-vrx (campagne accum3).
 * Cibles python (sim_abs, frais 0,15%/côté, exécution à l'open suivant) :
 *   IS  2018-04-05→2024-01-01 : +243,7% / DD -29,1% / 162 tr
 *   OOS 2024-01-01→2026-07-01 : +16,9% / DD -19,7% / 38 tr
 * Tolérance : quelques % (le moteur ajoute lot-size, slippage sur prix vs
 * coût multiplicatif, dust) — toute déviation LARGE = bug de port.
 *   bun apps/backend/src/research/accum3/vrxparity.ts
 */
import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import vrx from '../../../../../strategies/btc-vrx'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../../data') })

function cfg(start: string, end: string, params: Partial<ParamValues> = {}): BacktestConfig {
  return {
    strategyId: 'btc-vrx', params: params as ParamValues, market: 'spot', symbol: 'BTCUSDT',
    start: Date.parse(`${start}T00:00:00Z`), end: Date.parse(`${end}T00:00:00Z`),
    initialBalance: 1, denomination: 'base', leverage: 1,
    fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
    fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
    fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
  }
}

const f = (v: number): string => (v >= 0 ? '+' : '') + v.toFixed(1)
const windows: Array<[string, string, string, number, number, number]> = [
  ['IS 2018-04→2024-01', '2018-04-05', '2024-01-01', 243.7, -29.1, 162],
  ['OOS 2024-01→2026-07', '2024-01-01', '2026-07-01', 16.9, -19.7, 38],
]

for (const [label, start, end, pyNet, pyDd, pyTr] of windows) {
  const res = await runBacktest({ config: cfg(start, end), def: vrx, provider })
  const m = res.metrics
  console.log(
    `${label}: moteur ${f(m.netProfitPct)}% DD ${f(-m.maxDrawdownPct)}% ${m.totalTrades}tr  |  python ${f(pyNet)}% DD ${f(pyDd)}% ${pyTr}tr` +
      (res.haltedReason ? `  ⚠ halted: ${res.haltedReason}` : ''),
  )
}
process.exit(0)
