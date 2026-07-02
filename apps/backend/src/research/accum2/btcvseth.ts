/**
 * BTC Accumulator v2 : BTCUSDT vs ETHUSDT, mêmes fenêtres, dénomination base
 * (accumuler l'actif). 3 lignes : BTC défauts, ETH défauts, ETH params dédiés
 * (er0.45 + flow off — trouvés dans l'exploration X3, holdout déjà consommé).
 *   bun apps/backend/src/research/accum2/btcvseth.ts
 */
import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import accumV2 from '../../../../../strategies/btc-accumulator'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../../data') })

function cfg(symbol: string, params: ParamValues, a: string, b: string): BacktestConfig {
  return {
    strategyId: 'btc-accumulator-v2', params, market: 'spot', symbol,
    start: Date.parse(`${a}T00:00:00Z`), end: Date.parse(`${b}T00:00:00Z`),
    initialBalance: 1, denomination: 'base', leverage: 1,
    fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
    fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
    fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
  }
}
const f = (v: number, d = 1): string => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '—')

const WINDOWS: [string, string, string][] = [
  ['bear 2018', '2018-05-01', '2019-01-01'],
  ['2019→2026', '2019-01-01', '2026-06-13'],
  ['2020-08→2026', '2020-08-01', '2026-06-09'],
  ['bear 2022', '2021-11-01', '2023-01-01'],
  ['2024→2026 (holdout)', '2024-01-01', '2026-07-01'],
  ['full 2018→2026', '2018-04-05', '2026-07-01'],
]
const RUNS: [string, string, ParamValues][] = [
  ['BTC (défauts)', 'BTCUSDT', {}],
  ['ETH (défauts)', 'ETHUSDT', {}],
  ['ETH (er0.45+flowOff)', 'ETHUSDT', { erMin: 0.45, useFlowFilter: false }],
]

console.log('gain = actif accumulé vs le garder (base denom) ; prix± = variation USD sur la fenêtre\n')
for (const [wlabel, a, b] of WINDOWS) {
  console.log(`── ${wlabel} ──`)
  for (const [rlabel, symbol, params] of RUNS) {
    const res = await runBacktest({ config: cfg(symbol, params, a, b), def: accumV2, provider })
    const m = res.metrics
    const cs = await provider.getCandles('spot', symbol, '1d', Date.parse(`${a}T00:00:00Z`), Date.parse(`${b}T00:00:00Z`))
    const px = cs.length > 1 ? ((cs[cs.length - 1]!.close - cs[0]!.close) / cs[0]!.close) * 100 : 0
    console.log(
      `  ${rlabel.padEnd(22)} ${f(m.netProfitPct).padStart(8)}%  DD ${f(-m.maxDrawdownPct, 0).padStart(4)}%  ${String(m.totalTrades).padStart(3)}tr  WR ${f(m.winRate, 0).padStart(3)}%  PF ${f(m.profitFactor ?? 0, 2).padStart(5)}  (prix ${f(px, 0)}%)`,
    )
  }
}
process.exit(0)
