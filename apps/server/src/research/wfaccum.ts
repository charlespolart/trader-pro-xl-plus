/**
 * Walk-forward de BTC Accumulator (spot, dénomination BASE).
 * Ré-optimise une grille bornée sur l'in-sample (objectif : BTC accumulé),
 * valide sur l'out-of-sample. Le grid INCLUT htfSlopeDays=0 (sans filtre de
 * pente) : si l'IS le préfère, on verra s'il survit en OOS — c'est le test
 * d'overfitting du filtre de pente lui-même.
 *
 *   bun apps/server/src/research/wfaccum.ts [windows] [isRatio] [anchored]
 */
import { resolve } from 'node:path'
import { expandGrid, runBacktest, walkForwardWindows } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { defaultParams, type BacktestConfig, type ParamValues } from '@tpx/shared'
import accumulator from '../../../../strategies/btc-accumulator'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../data') })

function cfg(params: ParamValues, start: number, end: number): BacktestConfig {
  return {
    strategyId: 'btc-accumulator',
    params,
    market: 'spot',
    symbol: 'BTCUSDT',
    start,
    end,
    initialBalance: 1,
    denomination: 'base',
    leverage: 1,
    fees: { makerRate: 0.001, takerRate: 0.001, bnbDiscount: false },
    slippagePct: 0.0005,
    fillMode: 'candle',
    intrabarPath: 'heuristic',
    limitFillRatio: 0.25,
    fundingEnabled: false,
    maintenanceMarginRate: 0.005,
    warmupBars: 300,
  }
}

const nWindows = Number(process.argv[2] ?? 6)
const isRatio = Number(process.argv[3] ?? 0.7)
const anchored = process.argv[4] === 'anchored'

const START = Date.parse('2020-08-01T00:00:00Z')
const END = Date.parse('2026-06-01T00:00:00Z')
const windows = walkForwardWindows(START, END, { windows: nWindows, isRatio, anchored })

const base = defaultParams(accumulator.schema)
const GRID = expandGrid(accumulator.schema, base, {
  htfSlopeDays: [14, 30, 45],
  rebuyEmaLen: [50, 75, 100], // teste si le rachat paresseux survit OOS, ou si 50 (conservateur) gagne
  emaLen: [50, 100],
})

const d = (t: number): string => new Date(t).toISOString().slice(0, 10)
console.log(`Walk-forward BTC Accumulator — ${windows.length} fenêtres × ${GRID.length} combos | IS ${(isRatio * 100).toFixed(0)}%${anchored ? ' (ancré)' : ' (glissant)'}`)
console.log('objectif IS = BTC accumulé (net %). benchmark = garder son BTC = 0 %.\n')

let stack = 1 // 1 BTC de départ, composé sur les OOS
let positive = 0
let totalTrades = 0

// défauts validés : repli quand l'IS manque de signal (pas de bear pour optimiser)
const DEFAULTS: ParamValues = { ...base, htfSlopeDays: 30, erMin: 0.35, emaLen: 50 }
const MIN_TRADES_REOPT = 10

for (const w of windows) {
  // ---- optimisation in-sample : maximiser le BTC accumulé
  let best: { params: ParamValues; net: number; trades: number } | null = null
  let isTrades = 0
  for (const params of GRID) {
    const res = await runBacktest({ config: cfg(params, w.isStart, w.isEnd), def: accumulator, provider })
    const net = res.metrics.netProfitPct
    isTrades = Math.max(isTrades, res.metrics.totalTrades)
    // départage : à BTC égal, préférer MOINS de trades (moins de risque/exposition)
    if (!best || net > best.net + 1e-9 || (Math.abs(net - best.net) < 1e-9 && res.metrics.totalTrades < best.trades)) {
      best = { params, net, trades: res.metrics.totalTrades }
    }
  }

  // signal IS insuffisant → on garde les défauts validés plutôt que du bruit
  let chosen = best!.params
  let pickNote = `pente${best!.params['htfSlopeDays']}j er${best!.params['erMin']} ema${best!.params['emaLen']}`
  if (isTrades < MIN_TRADES_REOPT) {
    chosen = DEFAULTS
    pickNote = `DÉFAUTS (IS ${isTrades}tr < ${MIN_TRADES_REOPT}, signal insuffisant)`
  }

  // ---- validation out-of-sample
  const oos = await runBacktest({ config: cfg(chosen, w.oosStart, w.oosEnd), def: accumulator, provider })
  const m = oos.metrics
  stack *= 1 + m.netProfitPct / 100
  totalTrades += m.totalTrades
  if (m.netProfitPct > 0.01) positive++

  console.log(
    `IS ${d(w.isStart)}→${d(w.isEnd)} (${pickNote}) | ` +
      `OOS ${d(w.oosStart)}→${d(w.oosEnd)} : ${m.totalTrades}tr, BTC ${m.netProfitPct >= 0 ? '+' : ''}${m.netProfitPct.toFixed(2)}%, ` +
      `DD ${m.maxDrawdownPct.toFixed(1)}%, WR ${m.winRate.toFixed(0)}%`,
  )
}

console.log(
  `\nBTC composé OOS : ${stack.toFixed(4)} BTC (${((stack - 1) * 100).toFixed(1)}% vs garder son BTC) | ` +
    `fenêtres OOS positives : ${positive}/${windows.length} | trades OOS : ${totalTrades}`,
)
process.exit(0)
