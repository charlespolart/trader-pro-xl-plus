/**
 * Stress de robustesse v2 (défauts, données réparées) :
 *  A) frais/slippage ×2 et ×3 — l'edge survit-il à des coûts pessimistes ?
 *  B) sensibilité à la date de départ — départs mensuels 2018-05→2020-06,
 *     fin fixe 2026-06 (l'edge ne doit pas dépendre du point d'entrée).
 *   bun apps/backend/src/research/accum2/robust.ts
 */
import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import type { BacktestConfig, ParamValues } from '@tpx/shared'
import accumV2 from '../../../../../strategies/btc-accumulator-v2'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../../data') })

function cfg(taker: number, slip: number, start: number, end: number): BacktestConfig {
  return {
    strategyId: 'btc-accumulator-v2', params: {} as ParamValues, market: 'spot', symbol: 'BTCUSDT', start, end,
    initialBalance: 1, denomination: 'base', leverage: 1,
    fees: { makerRate: taker * 0.8, takerRate: taker }, slippagePct: slip,
    fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
    fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
  }
}
const f = (v: number, d = 1): string => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '—')

console.log('=== A) Stress coûts (2019→2026 et 2020-08→2026) ===')
console.log('coûts (taker/slip)      2019→2026                2020-08→2026')
for (const [label, taker, slip] of [
  ['base 0.10%/0.05%', 0.001, 0.0005],
  ['×2   0.20%/0.10%', 0.002, 0.001],
  ['×3   0.30%/0.15%', 0.003, 0.0015],
] as [string, number, number][]) {
  const r1 = await runBacktest({
    config: cfg(taker, slip, Date.parse('2019-01-01T00:00:00Z'), Date.parse('2026-06-13T00:00:00Z')),
    def: accumV2, provider,
  })
  const r2 = await runBacktest({
    config: cfg(taker, slip, Date.parse('2020-08-01T00:00:00Z'), Date.parse('2026-06-09T00:00:00Z')),
    def: accumV2, provider,
  })
  console.log(
    `${label.padEnd(20)} ${f(r1.metrics.netProfitPct).padStart(8)}% (DD ${f(-r1.metrics.maxDrawdownPct, 0)}%, ${r1.metrics.totalTrades}tr)   ${f(r2.metrics.netProfitPct).padStart(8)}% (DD ${f(-r2.metrics.maxDrawdownPct, 0)}%, ${r2.metrics.totalTrades}tr)`,
  )
}

console.log('\n=== B) Sensibilité à la date de départ (fin fixe 2026-06-13, coûts base) ===')
const end = Date.parse('2026-06-13T00:00:00Z')
const nets: number[] = []
for (let y = 2018, m = 5; y < 2020 || (y === 2020 && m <= 6); m++) {
  if (m > 12) { m = 1; y++ }
  const a = `${y}-${String(m).padStart(2, '0')}-01`
  const start = Date.parse(`${a}T00:00:00Z`)
  const res = await runBacktest({ config: cfg(0.001, 0.0005, start, end), def: accumV2, provider })
  nets.push(res.metrics.netProfitPct)
  console.log(`départ ${a} : ${f(res.metrics.netProfitPct).padStart(8)}%  (DD ${f(-res.metrics.maxDrawdownPct, 0)}%, ${res.metrics.totalTrades}tr)`)
}
const mn = Math.min(...nets), mx = Math.max(...nets)
const med = [...nets].sort((a, b) => a - b)[Math.floor(nets.length / 2)]!
console.log(`\nrésumé départs : min ${f(mn)}% | médiane ${f(med)}% | max ${f(mx)}% | positifs ${nets.filter((n) => n > 0).length}/${nets.length}`)
process.exit(0)
