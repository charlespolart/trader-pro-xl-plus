/**
 * Grille EXITS sur l'IS (2018-04-05 → 2024-01-01). Le holdout 2024→2026 ne
 * sera touché qu'UNE fois, pour la famille gagnante (médiane du plateau).
 *   bun apps/backend/src/research/accum2/gridexits.ts
 */
import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import accumV2 from '../../../../../strategies/btc-accumulator-v2'
import { v4exits } from './v4exits'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../../data') })

const START = Date.parse(process.env.GRID_START ?? '2018-04-05T00:00:00Z')
const END = Date.parse(process.env.GRID_END ?? '2024-01-01T00:00:00Z')

function cfg(strategyId: string, params: ParamValues): BacktestConfig {
  return {
    strategyId, params, market: 'spot', symbol: 'BTCUSDT', start: START, end: END,
    initialBalance: 1, denomination: 'base', leverage: 1,
    fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
    fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
    fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
  }
}
const f = (v: number, d = 1): string => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '—')
const W = [30, 8, 5, 6, 8, 8, 8, 8, 8]
const row = (c: string[]): string => c.map((x, i) => x.padStart(W[i] ?? 8)).join(' ')

async function run(label: string, def: typeof v4exits | typeof accumV2, id: string, params: ParamValues): Promise<void> {
  try {
    const res = await runBacktest({ config: cfg(id, params), def: def as never, provider })
    const m = res.metrics
    const tr = res.trades.filter((t) => t.exitTime !== null)
    const wins = tr.filter((t) => t.realizedPnl > 0).map((t) => t.realizedPnlPct)
    const losses = tr.filter((t) => t.realizedPnl <= 0).map((t) => t.realizedPnlPct)
    const avg = (a: number[]): number => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0)
    const worst = tr.length ? Math.min(...tr.map((t) => t.realizedPnlPct)) : 0
    console.log(
      row([
        label, String(m.totalTrades), f(m.winRate, 0), f(m.profitFactor ?? 0, 2),
        f(m.netProfitPct), f(-m.maxDrawdownPct), f(avg(wins)), f(avg(losses)), f(worst),
      ]) + (res.haltedReason ? ` ⚠ ${res.haltedReason}` : ''),
    )
  } catch (err) {
    console.log(`${label} ERREUR: ${err instanceof Error ? err.message : err}`)
  }
}

console.log(`IS ${new Date(START).toISOString().slice(0, 10)} → ${new Date(END).toISOString().slice(0, 10)}`)
console.log(row(['variante', 'trades', 'WR%', 'PF', 'BTC+%', 'maxDD%', 'gainMoy', 'perteMoy', 'pire']))

await run('v2 native (référence)', accumV2, 'btc-accumulator-v2', {})
await run('v4 recross (parité)', v4exits, 'v4', { exitMode: 'recross' })
for (const mh of [6, 12, 18]) {
  await run(`v4 recross minHold=${mh}`, v4exits, 'v4', { exitMode: 'recross', minHoldBars: mh })
}
console.log()
for (const k of [1.5, 2.0, 2.5, 3.0]) {
  await run(`v4 trail k=${k}`, v4exits, 'v4', { exitMode: 'trail', trailAtrMult: k })
}
console.log()
for (const k of [2.0, 2.5, 3.0]) {
  await run(`v4 trail+recross k=${k}`, v4exits, 'v4', { exitMode: 'trailrecross', trailAtrMult: k })
}
console.log()
for (const steps of [2, 3, 4]) {
  for (const pct of [3, 5, 8]) {
    await run(`v4 ladder ${steps}×${pct}%`, v4exits, 'v4', { exitMode: 'ladder', ladderSteps: steps, ladderStepPct: pct })
  }
}
process.exit(0)
