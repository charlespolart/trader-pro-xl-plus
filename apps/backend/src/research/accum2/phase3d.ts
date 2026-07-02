/**
 * ROBUSTESSE AU DÉPHASAGE DES BOUGIES 3D — protocole : voir en-tête de
 * phasestrat.ts. offset=1 ≡ grille native (parité), 0/2 = autres phases.
 *   bun apps/backend/src/research/accum2/phase3d.ts
 */
import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import accumV2 from '../../../../../strategies/btc-accumulator'
import { phaseStrategy } from './phasestrat'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../../data') })

function cfg(strategyId: string, params: ParamValues, start: number, end: number, warmupBars = 1000): BacktestConfig {
  return {
    strategyId, params, market: 'spot', symbol: 'BTCUSDT', start, end,
    initialBalance: 1, denomination: 'base', leverage: 1,
    fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
    fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
    fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars,
  }
}
const f = (v: number, d = 2): string => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '—')
const W = [24, 18, 7, 5, 6, 8, 8]
const row = (c: string[]): string => c.map((x, i) => x.padStart(W[i] ?? 8)).join(' ')

const WINDOWS: [string, string, string][] = [
  ['2019→2026', '2019-01-01', '2026-06-13'],
  ['2020-08→2026', '2020-08-01', '2026-06-09'],
  ['full 2018→2026', '2018-04-05', '2026-07-01'],
  ['oos 2024→2026', '2024-01-01', '2026-07-01'],
]

console.log(row(['variante', 'fenêtre', 'trades', 'WR%', 'PF', 'BTC+%', 'maxDD%']))
for (const [label, a, b] of WINDOWS) {
  const start = Date.parse(`${a}T00:00:00Z`)
  const end = Date.parse(`${b}T00:00:00Z`)
  // référence : v2 native (bougies 3d Binance), à warmup 300 (historique) et 1000 (converge)
  for (const wu of [300, 1000]) {
    const ref = await runBacktest({ config: cfg('btc-accumulator-v2', {}, start, end, wu), def: accumV2, provider })
    console.log(
      row([`v2 native (warmup ${wu})`, label, String(ref.metrics.totalTrades), f(ref.metrics.winRate, 0), f(ref.metrics.profitFactor ?? 0), f(ref.metrics.netProfitPct), f(-ref.metrics.maxDrawdownPct, 1)]),
    )
  }
  for (const offset of [1, 0, 2]) {
    const res = await runBacktest({
      config: cfg('v2-phase', { phaseOffset: offset }, start, end),
      def: phaseStrategy,
      provider,
    })
    const m = res.metrics
    console.log(
      row([
        `resample offset=${offset}${offset === 1 ? ' (=natif)' : ''}`,
        label, String(m.totalTrades), f(m.winRate, 0), f(m.profitFactor ?? 0), f(m.netProfitPct), f(-m.maxDrawdownPct, 1),
      ]) + (res.haltedReason ? ` ⚠ ${res.haltedReason}` : ''),
    )
  }
  console.log()
}
process.exit(0)
