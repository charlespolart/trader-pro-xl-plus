/**
 * Walk-forward de BTC Accumulator v2 (spot, base) — teste si l'edge du TF de
 * tendance « 3 jours » SURVIT hors-échantillon, ou s'il n'était qu'un effet de
 * la fenêtre 2020-08→2026 que j'avais choisie.
 *
 * Démarre en 2019-01 (FORCE la traversée de la reprise 2019 + covid 2020, là
 * où la v2 saignait). À chaque fenêtre, l'optimiseur IS choisit parmi des
 * configs de tendance (1d façon v1, 3d, 1w), objectif = BTC accumulé. On valide
 * en OOS, et on compare côte à côte à deux références FIXES : v1 (1d/200/30) et
 * v2 3d-figé (3d/60/8). Question : la ré-optim garde-t-elle le 3d, et bat-elle
 * les références fixes ?
 *
 *   bun apps/server/src/research/wfaccumv2.ts [windows] [isRatio] [anchored]
 */
import { resolve } from 'node:path'
import { runBacktest, walkForwardWindows } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { defaultParams, type BacktestConfig, type ParamValues } from '@tpx/shared'
import accumV1 from '../../../../strategies/btc-accumulator'
import accumV2 from '../../../../strategies/btc-accumulator-v2'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../data') })

function cfg(strategyId: string, params: ParamValues, start: number, end: number): BacktestConfig {
  return {
    strategyId, params, market: 'spot', symbol: 'BTCUSDT', start, end,
    initialBalance: 1, denomination: 'base', leverage: 1,
    fees: { makerRate: 0.001, takerRate: 0.001, bnbDiscount: false }, slippagePct: 0.0005,
    fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
    fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
  }
}
const d = (t: number): string => new Date(t).toISOString().slice(0, 10)

const nWindows = Number(process.argv[2] ?? 6)
const isRatio = Number(process.argv[3] ?? 0.7)
const anchored = process.argv[4] === 'anchored'

const START = Date.parse('2019-01-01T00:00:00Z')
const END = Date.parse('2026-06-01T00:00:00Z')
const windows = walkForwardWindows(START, END, { windows: nWindows, isRatio, anchored })

const base = defaultParams(accumV2.schema)
// configs de tendance candidates (cœur ER+flow+EMA+stop fixé aux défauts validés)
const TREND_CONFIGS: { label: string; p: ParamValues }[] = [
  { label: '1d/200/30', p: { trendInterval: '1d', trendMaLen: 200, trendSlopeBars: 30 } }, // = v1
  { label: '1d/100/15', p: { trendInterval: '1d', trendMaLen: 100, trendSlopeBars: 15 } },
  { label: '3d/60/8', p: { trendInterval: '3d', trendMaLen: 60, trendSlopeBars: 8 } },
  { label: '3d/70/8', p: { trendInterval: '3d', trendMaLen: 70, trendSlopeBars: 8 } },
  { label: '3d/60/6', p: { trendInterval: '3d', trendMaLen: 60, trendSlopeBars: 6 } },
  { label: '3d/80/10', p: { trendInterval: '3d', trendMaLen: 80, trendSlopeBars: 10 } },
  { label: '1w/50/6', p: { trendInterval: '1w', trendMaLen: 50, trendSlopeBars: 6 } },
  { label: '1w/40/4', p: { trendInterval: '1w', trendMaLen: 40, trendSlopeBars: 4 } },
]
const GRID = TREND_CONFIGS.map((t) => ({ label: t.label, params: { ...base, ...t.p } }))

const DEFAULT_3D: ParamValues = { ...base, trendInterval: '3d', trendMaLen: 60, trendSlopeBars: 8 }
const V1_FIXED: ParamValues = { htfSlopeDays: 30, erMin: 0.35, emaLen: 50 }
const MIN_TRADES_REOPT = 8

console.log(`Walk-forward v2 — ${windows.length} fenêtres × ${GRID.length} configs de tendance | IS ${(isRatio * 100).toFixed(0)}%${anchored ? ' (ancré)' : ' (glissant)'} | 2019→2026`)
console.log('objectif IS = BTC accumulé. benchmark = garder son BTC = 0 %. (TF/longueurMA/déclin)\n')

let stackWF = 1 // ré-optimisée
let stackV1 = 1 // v1 figée
let stack3d = 1 // v2 3d figée
let posWF = 0, posV1 = 0, pos3d = 0
const pickCount = new Map<string, number>()

for (const w of windows) {
  // ---- optimisation IS : maximiser le BTC accumulé (départage : moins de trades)
  let best: { label: string; params: ParamValues; net: number; trades: number } | null = null
  let isTrades = 0
  for (const g of GRID) {
    const res = await runBacktest({ config: cfg('btc-accumulator-v2', g.params, w.isStart, w.isEnd), def: accumV2, provider })
    const net = res.metrics.netProfitPct
    isTrades = Math.max(isTrades, res.metrics.totalTrades)
    if (!best || net > best.net + 1e-9 || (Math.abs(net - best.net) < 1e-9 && res.metrics.totalTrades < best.trades)) {
      best = { label: g.label, params: g.params, net, trades: res.metrics.totalTrades }
    }
  }

  let chosen = best!.params
  let pick = best!.label
  if (isTrades < MIN_TRADES_REOPT) {
    chosen = DEFAULT_3D
    pick = `DÉFAUT 3d/60/8 (IS ${isTrades}tr < ${MIN_TRADES_REOPT})`
  }
  pickCount.set(pick.startsWith('DÉFAUT') ? '3d/60/8 (défaut)' : pick, (pickCount.get(pick.startsWith('DÉFAUT') ? '3d/60/8 (défaut)' : pick) ?? 0) + 1)

  // ---- OOS : la ré-optim, + 2 références fixes sur la MÊME fenêtre OOS
  const oosWF = (await runBacktest({ config: cfg('btc-accumulator-v2', chosen, w.oosStart, w.oosEnd), def: accumV2, provider })).metrics
  const oosV1 = (await runBacktest({ config: cfg('btc-accumulator', V1_FIXED, w.oosStart, w.oosEnd), def: accumV1, provider })).metrics
  const oos3d = (await runBacktest({ config: cfg('btc-accumulator-v2', DEFAULT_3D, w.oosStart, w.oosEnd), def: accumV2, provider })).metrics

  stackWF *= 1 + oosWF.netProfitPct / 100
  stackV1 *= 1 + oosV1.netProfitPct / 100
  stack3d *= 1 + oos3d.netProfitPct / 100
  if (oosWF.netProfitPct > 0.01) posWF++
  if (oosV1.netProfitPct > 0.01) posV1++
  if (oos3d.netProfitPct > 0.01) pos3d++

  const fp = (v: number): string => (v >= 0 ? '+' : '') + v.toFixed(1)
  console.log(
    `OOS ${d(w.oosStart)}→${d(w.oosEnd)} | IS choisit ${pick.padEnd(16)} → ` +
      `réopt ${fp(oosWF.netProfitPct).padStart(6)}% (DD ${oosWF.maxDrawdownPct.toFixed(0)}%, ${oosWF.totalTrades}tr) | ` +
      `v1 ${fp(oosV1.netProfitPct).padStart(6)}% | 3d-figé ${fp(oos3d.netProfitPct).padStart(6)}%`,
  )
}

const tot = (s: number): string => `${s.toFixed(4)} BTC (${((s - 1) * 100).toFixed(1)}%)`
console.log(`\n── Composé OOS (1 BTC de départ) ──`)
console.log(`  ré-optimisée  : ${tot(stackWF)} | fenêtres + : ${posWF}/${windows.length}`)
console.log(`  v1 figée      : ${tot(stackV1)} | fenêtres + : ${posV1}/${windows.length}`)
console.log(`  v2 3d figée   : ${tot(stack3d)} | fenêtres + : ${pos3d}/${windows.length}`)
console.log(`\nChoix IS sur ${windows.length} fenêtres :`, [...pickCount.entries()].map(([k, v]) => `${k}×${v}`).join(', '))
process.exit(0)
