/**
 * WF FINAL pour le verdict : v2 défauts vs v1 défauts, configs FIGÉES,
 * fenêtres OOS glissantes sur TOUTE l'histoire dispo (2018-04 → 2026-07,
 * inclut bear 2018 + 2019-20 + 2022 + 2024-26). Données réparées.
 *   bun apps/backend/src/research/accum2/finalwf.ts
 */
import { resolve } from 'node:path'
import { runBacktest, walkForwardWindows, type StrategyDefinition } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import accumV1 from '../../../../../strategies/btc-accumulator'
import accumV2 from '../../../../../strategies/btc-accumulator-v2'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../../data') })

function cfg(strategyId: string, params: ParamValues, start: number, end: number): BacktestConfig {
  return {
    strategyId, params, market: 'spot', symbol: 'BTCUSDT', start, end,
    initialBalance: 1, denomination: 'base', leverage: 1,
    fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
    fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
    fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
  }
}
const d = (t: number): string => new Date(t).toISOString().slice(0, 10)
const f = (v: number): string => (v >= 0 ? '+' : '') + v.toFixed(1)

const START = Date.parse('2018-04-05T00:00:00Z')
const END = Date.parse('2026-07-01T00:00:00Z')
const windows = walkForwardWindows(START, END, { windows: 8, isRatio: 0.5, anchored: false })

const RUNS: { label: string; def: StrategyDefinition; id: string }[] = [
  { label: 'v2 (3d/60/8 + confirm)', def: accumV2, id: 'btc-accumulator-v2' },
  { label: 'v1 (1d/200/30)', def: accumV1, id: 'btc-accumulator' },
]

const acc = RUNS.map(() => ({ stack: 1, pos: 0, dd: 0 }))
console.log(`WF final — ${windows.length} tranches OOS glissantes, 2018-04→2026-07, configs figées\n`)
for (const w of windows) {
  const parts: string[] = []
  for (let i = 0; i < RUNS.length; i++) {
    const r = RUNS[i]!
    const res = await runBacktest({ config: cfg(r.id, {}, w.oosStart, w.oosEnd), def: r.def, provider })
    const net = res.metrics.netProfitPct
    acc[i]!.stack *= 1 + net / 100
    if (net > 0.01) acc[i]!.pos++
    acc[i]!.dd = Math.max(acc[i]!.dd, res.metrics.maxDrawdownPct)
    parts.push(`${r.label.split(' ')[0]} ${f(net).padStart(6)}% (${res.metrics.totalTrades}tr)`)
  }
  console.log(`OOS ${d(w.oosStart)}→${d(w.oosEnd)} | ${parts.join(' | ')}`)
}
console.log('\n── composé OOS 2018→2026 (1 BTC de départ, configs figées) ──')
for (let i = 0; i < RUNS.length; i++) {
  console.log(
    `  ${RUNS[i]!.label.padEnd(24)} ${((acc[i]!.stack - 1) * 100 >= 0 ? '+' : '')}${((acc[i]!.stack - 1) * 100).toFixed(1)}% | tranches + : ${acc[i]!.pos}/${windows.length} | pire DD de tranche ${acc[i]!.dd.toFixed(0)}%`,
  )
}
process.exit(0)
