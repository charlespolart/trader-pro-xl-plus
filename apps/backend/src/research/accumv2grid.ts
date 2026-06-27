/**
 * Cartographie le plateau de la tendance 3 jours pour BTC Accumulator v2.
 * But : vérifier que le gain vu en 3d/60/8 est un PLATEAU (effet robuste du
 * timeframe) et pas un pic isolé (sur-ajustement). On balaie trendMaLen ×
 * trendSlopeBars sur IS / OOS / full / bear22.
 *
 *   bun apps/backend/src/research/accumv2grid.ts
 */
import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import accumulatorV2 from '../../../../strategies/btc-accumulator-v2'
import { PERIODS } from './run'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../data') })

function cfg(params: ParamValues, start: number, end: number): BacktestConfig {
  return {
    strategyId: 'btc-accumulator-v2',
    params,
    market: 'spot',
    symbol: 'BTCUSDT',
    start,
    end,
    initialBalance: 1,
    denomination: 'base',
    leverage: 1,
    fees: { ...DEFAULT_FEES.spot },
    slippagePct: 0.0005,
    fillMode: 'candle',
    intrabarPath: 'heuristic',
    limitFillRatio: 0.25,
    fundingEnabled: false,
    maintenanceMarginRate: 0.005,
    warmupBars: 300,
  }
}

const fmt = (v: number, d = 1): string => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '—')

async function btcPct(params: ParamValues, range: [string, string]): Promise<number> {
  const start = Date.parse(`${range[0]}T00:00:00Z`)
  const end = Date.parse(`${range[1]}T00:00:00Z`)
  const res = await runBacktest({ config: cfg(params, start, end), def: accumulatorV2, provider })
  return res.metrics.netProfitPct
}

const lens = [50, 60, 70, 80, 100]
const slopes = [6, 8, 10, 12]
const FULL: [string, string] = ['2020-08-01', '2026-06-09']

for (const [periodName, range] of [
  ['IS  (2020-08→2024-06)', PERIODS['is']!],
  ['OOS (2024-06→2026-06)', PERIODS['oos']!],
  ['FULL (2020-08→2026-06)', FULL],
  ['BEAR22', PERIODS['bear22']!],
] as [string, [string, string]][]) {
  console.log(`\n=== ${periodName} — BTC accumulé (%), tendance sur 3d ===`)
  console.log('  maLen \\ slope' + slopes.map((s) => String(s).padStart(9)).join(''))
  for (const len of lens) {
    const cells: string[] = []
    for (const slope of slopes) {
      try {
        const v = await btcPct({ trendInterval: '3d', trendMaLen: len, trendSlopeBars: slope }, range)
        cells.push(fmt(v).padStart(9))
      } catch (err) {
        cells.push('ERR'.padStart(9))
        console.error(`  ${len}/${slope}: ${err instanceof Error ? err.message : err}`)
      }
    }
    console.log(`  EMA${String(len).padEnd(8)}` + cells.join(''))
  }
}
process.exit(0)
