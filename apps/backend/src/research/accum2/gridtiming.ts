/**
 * AXE GRAIN DE TIMING : la v2 décide sur 4h — jamais testé autrement.
 * Deux vues par intervalle :
 *   - « mêmes barres » : params natifs (EMA50 barres, etc.) → dynamique + rapide
 *   - « même temps »   : params rescalés ×(4h/I) → mêmes constantes de temps,
 *     seule la granularité de décision/exit change
 * IS 2018-04→2024-01 (holdout intouché). Régime (3d+1d) inchangé.
 *   bun apps/backend/src/research/accum2/gridtiming.ts
 */
import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type Interval, type ParamValues } from '@tpx/shared'
import accumV2 from '../../../../../strategies/btc-accumulator'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../../data') })

const START = Date.parse('2018-04-05T00:00:00Z')
const END = Date.parse('2024-01-01T00:00:00Z')

function cfg(params: ParamValues): BacktestConfig {
  return {
    strategyId: 'btc-accumulator-v2', params, market: 'spot', symbol: 'BTCUSDT', start: START, end: END,
    initialBalance: 1, denomination: 'base', leverage: 1,
    fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
    fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
    fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
  }
}
const f = (v: number, d = 1): string => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '—')

async function run(label: string, params: ParamValues): Promise<void> {
  try {
    const res = await runBacktest({ config: cfg(params), def: accumV2, provider })
    const m = res.metrics
    const tr = res.trades.filter((t) => t.exitTime !== null)
    const worst = tr.length ? Math.min(...tr.map((t) => t.realizedPnlPct)) : 0
    console.log(
      `${label.padEnd(30)} ${f(m.netProfitPct).padStart(8)}%  DD ${f(-m.maxDrawdownPct, 0).padStart(4)}%  ${String(m.totalTrades).padStart(4)}tr  PF ${f(m.profitFactor ?? 0, 2)}  WR ${f(m.winRate, 0)}%  pire ${f(worst)}%  frais ${f(m.totalFees * 100, 1)}%BTC`,
    )
  } catch (err) {
    console.log(`${label} ERREUR: ${err instanceof Error ? err.message : err}`)
  }
}

const INTERVALS: { itv: Interval; scale: number }[] = [
  { itv: '1h', scale: 4 },
  { itv: '2h', scale: 2 },
  { itv: '4h', scale: 1 },
  { itv: '8h', scale: 0.5 },
  { itv: '12h', scale: 1 / 3 },
]

console.log('=== vue « mêmes barres » (params natifs, constantes de temps ∝ intervalle) ===')
for (const { itv } of INTERVALS) {
  await run(`${itv} natif`, { interval: itv })
}
console.log('\n=== vue « même temps » (params rescalés — seul le grain de décision change) ===')
for (const { itv, scale } of INTERVALS) {
  const r = (x: number): number => Math.min(60, Math.max(2, Math.round(x * scale)))
  await run(`${itv} rescalé (×${scale})`, {
    interval: itv,
    erLen: Math.min(60, Math.max(2, Math.round(20 * scale))), emaLen: Math.max(2, Math.round(50 * scale)), rebuyEmaLen: Math.max(2, Math.round(50 * scale)), flowLen: Math.min(50, Math.max(2, Math.round(10 * scale))), atrPeriod: Math.max(2, Math.round(14 * scale)),
  })
}
process.exit(0)
