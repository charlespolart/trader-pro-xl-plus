/**
 * Walk-forward : la double confirmation (3d + journalier) survit-elle l'OOS ?
 * Compare, sur les MÊMES fenêtres OOS séquentielles (2019→2026), la v2 3d/60/8
 * FIGÉE sans confirmation vs avec. Pas de ré-optim (le WF précédent a montré
 * qu'elle nuit) — on teste juste si le 2ᵉ filtre tient hors-échantillon.
 *
 *   bun apps/backend/src/research/wfconfirm.ts [windows] [isRatio]
 */
import { resolve } from 'node:path'
import { runBacktest, walkForwardWindows } from '@tpx/core'
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
const d = (t: number): string => new Date(t).toISOString().slice(0, 10)
const fp = (v: number): string => (v >= 0 ? '+' : '') + v.toFixed(1)
const BASE: ParamValues = { trendInterval: '3d', trendMaLen: 60, trendSlopeBars: 8 }

const nWindows = Number(process.argv[2] ?? 6)
const isRatio = Number(process.argv[3] ?? 0.7)
const windows = walkForwardWindows(Date.parse('2019-01-01T00:00:00Z'), Date.parse('2026-06-01T00:00:00Z'), { windows: nWindows, isRatio })

console.log(`Walk-forward double confirmation — ${windows.length} fenêtres OOS séquentielles 2019→2026\n`)
let sOff = 1, sOn = 1, pOff = 0, pOn = 0
let ddOff = 0, ddOn = 0

for (const w of windows) {
  const off = (await runBacktest({ config: cfg({ ...BASE, useConfirm: false }, w.oosStart, w.oosEnd), def: accumV2, provider })).metrics
  const on = (await runBacktest({ config: cfg({ ...BASE, useConfirm: true }, w.oosStart, w.oosEnd), def: accumV2, provider })).metrics
  sOff *= 1 + off.netProfitPct / 100
  sOn *= 1 + on.netProfitPct / 100
  if (off.netProfitPct > 0.01) pOff++
  if (on.netProfitPct > 0.01) pOn++
  ddOff = Math.max(ddOff, off.maxDrawdownPct)
  ddOn = Math.max(ddOn, on.maxDrawdownPct)
  console.log(
    `OOS ${d(w.oosStart)}→${d(w.oosEnd)} | 3d seul ${fp(off.netProfitPct).padStart(6)}% (DD ${off.maxDrawdownPct.toFixed(0)}%) | 3d+1d ${fp(on.netProfitPct).padStart(6)}% (DD ${on.maxDrawdownPct.toFixed(0)}%)`,
  )
}

const tot = (s: number): string => `${s.toFixed(4)} BTC (${((s - 1) * 100).toFixed(1)}%)`
console.log(`\n── Composé OOS ──`)
console.log(`  3d seul  : ${tot(sOff)} | fenêtres + : ${pOff}/${windows.length} | pire DD fenêtre ${ddOff.toFixed(0)}%`)
console.log(`  3d + 1d  : ${tot(sOn)} | fenêtres + : ${pOn}/${windows.length} | pire DD fenêtre ${ddOn.toFixed(0)}%`)
process.exit(0)
