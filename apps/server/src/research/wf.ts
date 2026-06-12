/**
 * Walk-forward de la famille ER-trend sur tout l'historique :
 * ré-optimisation périodique (in-sample) puis validation sur la fenêtre
 * suivante (out-of-sample). La performance OOS composée ≈ ce qu'aurait fait
 * le bot en réel avec des re-fits trimestriels.
 */
import { resolve } from 'node:path'
import { expandGrid, runBacktest, walkForwardWindows } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { defaultParams, type ParamValues } from '@tpx/shared'
import { FAMILIES } from './families'
import { mkConfig } from './run'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../data') })

const fam = FAMILIES.find((f) => f.key === 'ertrend')!
const base: ParamValues = {
  ...defaultParams(fam.def.schema),
  useFlowFilter: true,
  flowTh: 0.5,
}
const GRID = expandGrid(fam.def.schema, base, {
  erMin: [0.25, 0.35, 0.45],
  emaLen: [50, 100],
  atrMult: [2, 3],
})

const START = Date.parse('2020-08-01T00:00:00Z')
const END = Date.parse('2026-06-09T00:00:00Z')
const windows = walkForwardWindows(START, END, { windows: 5, isRatio: 0.7 })

const d = (t: number): string => new Date(t).toISOString().slice(0, 10)
let equity = 1
let totalTrades = 0
let positive = 0

console.log(`walk-forward ER-trend+flow — ${windows.length} fenêtres × ${GRID.length} combos IS`)
for (const w of windows) {
  let best: { params: ParamValues; score: number } | null = null
  for (const params of GRID) {
    const res = await runBacktest({ config: mkConfig(params, w.isStart, w.isEnd), def: fam.def, provider })
    const m = res.metrics
    // PF pénalisé si trop peu de trades pour être significatif
    const score = m.totalTrades >= 15 ? (m.profitFactor ?? 0) : -1
    if (!best || score > best.score) best = { params, score }
  }
  const oos = await runBacktest({ config: mkConfig(best!.params, w.oosStart, w.oosEnd), def: fam.def, provider })
  const m = oos.metrics
  equity *= 1 + m.netProfitPct / 100
  totalTrades += m.totalTrades
  if (m.netProfitPct > 0) positive++
  const pick = ['erMin', 'emaLen', 'atrMult'].map((k) => `${k}=${best!.params[k]}`).join(' ')
  console.log(
    `IS ${d(w.isStart)}→${d(w.isEnd)} (PF ${best!.score.toFixed(2)}, ${pick}) | OOS ${d(w.oosStart)}→${d(w.oosEnd)} : ` +
      `${m.totalTrades} trades, PF ${(m.profitFactor ?? 0).toFixed(2)}, net ${m.netProfitPct.toFixed(1)}%, dd ${m.maxDrawdownPct.toFixed(1)}%, B&H ${m.buyHoldReturnPct.toFixed(0)}%`,
  )
}
console.log(`\nOOS composé : ${((equity - 1) * 100).toFixed(1)}% | fenêtres positives : ${positive}/${windows.length} | trades OOS : ${totalTrades}`)
process.exit(0)
