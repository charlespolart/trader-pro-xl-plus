/**
 * Vente fractionnée : balaye sellFraction sur la v3 → couple (rendement, drawdown).
 * f=1 doit ≈ la v2 (+90%/-29% sur 2019→2026) = contrôle de parité.
 *   bun apps/server/src/research/fractest.ts
 */
import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import accumV3 from '../../../../strategies/btc-accumulator-v3'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../data') })
function cfg(params: ParamValues, a: string, b: string): BacktestConfig {
  return {
    strategyId: 'btc-accumulator-v3', params, market: 'spot', symbol: 'BTCUSDT',
    start: Date.parse(`${a}T00:00:00Z`), end: Date.parse(`${b}T00:00:00Z`),
    initialBalance: 1, denomination: 'base', leverage: 1,
    fees: { ...DEFAULT_FEES.spot, bnbDiscount: true }, slippagePct: 0.0005,
    fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
    fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
  }
}
const f = (v: number, d = 1): string => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '—')

for (const [label, a, b] of [
  ['2019→2026 (réaliste)', '2019-01-01', '2026-06-13'],
  ['2020-08→2026 (propre)', '2020-08-01', '2026-06-09'],
] as const) {
  console.log(`\n=== ${label} — vente fractionnée (v3) ===`)
  console.log('fraction'.padEnd(12) + ['BTC+%', 'maxDD%', 'rendt/DD', 'trades', 'WR%', 'expo%'].map((s) => s.padStart(11)).join(''))
  for (const frac of [1.0, 0.75, 0.5, 0.25]) {
    const r = await runBacktest({ config: cfg({ sellFraction: frac }, a, b), def: accumV3, provider })
    const m = r.metrics
    const ratio = m.maxDrawdownPct > 0 ? m.netProfitPct / m.maxDrawdownPct : Infinity
    const tr = r.trades.filter((t) => t.exitTime !== null)
    const wr = tr.length ? (tr.filter((t) => t.realizedPnl > 0).length / tr.length) * 100 : 0
    console.log(
      `${(frac * 100).toFixed(0) + '%'}`.padEnd(12) +
        [f(m.netProfitPct, 1), f(-m.maxDrawdownPct, 1), f(ratio, 2), String(tr.length), wr.toFixed(0), f(m.exposurePct, 0)]
          .map((x) => x.padStart(11))
          .join(''),
    )
  }
}
console.log('\n(f=100% = comportement v2 ; rendt/DD = rendement ÷ |drawdown|, plus haut = mieux ajusté au risque)')
process.exit(0)
