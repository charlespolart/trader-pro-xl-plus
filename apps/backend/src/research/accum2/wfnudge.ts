/**
 * Consistance sous-périodes des candidats « macro plus lente » (issus du
 * plateau IS) — fenêtres glissantes DANS 2018-04→2024-01 (holdout 2024+
 * intouché). Configs FIGÉES comparées sur chaque tranche OOS.
 *   bun apps/backend/src/research/accum2/wfnudge.ts
 */
import { resolve } from 'node:path'
import { runBacktest, walkForwardWindows } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import accumV2 from '../../../../../strategies/btc-accumulator'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../../data') })

function cfg(params: ParamValues, start: number, end: number): BacktestConfig {
  return {
    strategyId: 'btc-accumulator-v2', params, market: 'spot', symbol: 'BTCUSDT', start, end,
    initialBalance: 1, denomination: 'base', leverage: 1,
    fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
    fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
    fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
  }
}
const d = (t: number): string => new Date(t).toISOString().slice(0, 10)
const f = (v: number): string => (v >= 0 ? '+' : '') + v.toFixed(1)

const CANDIDATES: { label: string; p: ParamValues }[] = [
  { label: 'défauts 3d/60/8+c200', p: {} },
  { label: '3d/70/10', p: { trendMaLen: 70, trendSlopeBars: 10 } },
  { label: '3d/80/8', p: { trendMaLen: 80, trendSlopeBars: 8 } },
  { label: 'confirm250', p: { confirmMaLen: 250 } },
  { label: '3d/80/8+c250', p: { trendMaLen: 80, trendSlopeBars: 8, confirmMaLen: 250 } },
  { label: '1d/250/30', p: { trendInterval: '1d', trendMaLen: 250, trendSlopeBars: 30 } },
]

const START = Date.parse('2018-04-05T00:00:00Z')
const END = Date.parse('2024-01-01T00:00:00Z')
const windows = walkForwardWindows(START, END, { windows: 6, isRatio: 0.5, anchored: false })

const stacks = new Map<string, { stack: number; pos: number }>()
for (const c of CANDIDATES) stacks.set(c.label, { stack: 1, pos: 0 })

console.log(`fenêtres OOS glissantes dans 2018-04→2024-01 (sélection sans toucher 2024+)\n`)
for (const w of windows) {
  const parts: string[] = []
  for (const c of CANDIDATES) {
    const res = await runBacktest({ config: cfg(c.p, w.oosStart, w.oosEnd), def: accumV2, provider })
    const net = res.metrics.netProfitPct
    const s = stacks.get(c.label)!
    s.stack *= 1 + net / 100
    if (net > 0.01) s.pos++
    parts.push(`${c.label} ${f(net).padStart(6)}%`)
  }
  console.log(`OOS ${d(w.oosStart)}→${d(w.oosEnd)} | ${parts.join(' | ')}`)
}
console.log('\n── composé OOS (fenêtres glissantes 2018→2024) ──')
for (const c of CANDIDATES) {
  const s = stacks.get(c.label)!
  console.log(`  ${c.label.padEnd(22)} ${f((s.stack - 1) * 100).padStart(7)}% | fenêtres + : ${s.pos}/${windows.length}`)
}
process.exit(0)
