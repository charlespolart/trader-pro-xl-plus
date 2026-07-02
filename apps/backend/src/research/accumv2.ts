/**
 * Compare l'unité de temps de la TENDANCE GÉNÉRALE pour l'accumulateur de BTC.
 * v1 (btc-accumulator) = tendance figée sur EMA200 1d ; v2 = tendance sur un TF
 * dédié et configurable (1d/3d/1w). On vérifie d'abord la parité (v2 1d/200/30
 * doit ≈ v1), puis on teste si monter en 3d/1w aide.
 *
 *   bun apps/backend/src/research/accumv2.ts
 */
import { resolve } from 'node:path'
import { runBacktest, type StrategyDefinition } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import accumulatorV1 from './accum2/legacy/btc-accumulator-v1'
import accumulatorV2 from '../../../../strategies/btc-accumulator'
import { PERIODS } from './run'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../data') })

function cfg(strategyId: string, params: ParamValues, start: number, end: number): BacktestConfig {
  return {
    strategyId,
    params,
    market: 'spot',
    symbol: 'BTCUSDT',
    start,
    end,
    initialBalance: 1, // 1 BTC
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

const fmt = (v: number, d = 2): string => (Number.isFinite(v) ? v.toFixed(d) : '—')
const W = [22, 8, 7, 6, 6, 8, 8, 7]
const row = (c: string[]): string => c.map((x, i) => x.padStart(W[i] ?? 8)).join(' ')

interface Variant {
  label: string
  def: StrategyDefinition
  strategyId: string
  params: ParamValues
}

const variants: Variant[] = [
  // référence v1 (tendance EMA200 1d, déclin 30 j)
  { label: 'v1 (1d/200/30j)', def: accumulatorV1, strategyId: 'btc-accumulator', params: { htfSlopeDays: 30 } },
  // parité : v2 réglée comme la v1 → doit donner ~les mêmes chiffres
  { label: 'v2 1d/200/30', def: accumulatorV2, strategyId: 'btc-accumulator-v2', params: { trendInterval: '1d', trendMaLen: 200, trendSlopeBars: 30 } },
  // tendance journalière plus réactive
  { label: 'v2 1d/100/15', def: accumulatorV2, strategyId: 'btc-accumulator-v2', params: { trendInterval: '1d', trendMaLen: 100, trendSlopeBars: 15 } },
  // tendance sur 3 jours
  { label: 'v2 3d/80/10', def: accumulatorV2, strategyId: 'btc-accumulator-v2', params: { trendInterval: '3d', trendMaLen: 80, trendSlopeBars: 10 } },
  { label: 'v2 3d/60/8', def: accumulatorV2, strategyId: 'btc-accumulator-v2', params: { trendInterval: '3d', trendMaLen: 60, trendSlopeBars: 8 } },
  // tendance hebdomadaire
  { label: 'v2 1w/50/6', def: accumulatorV2, strategyId: 'btc-accumulator-v2', params: { trendInterval: '1w', trendMaLen: 50, trendSlopeBars: 6 } },
  { label: 'v2 1w/40/4', def: accumulatorV2, strategyId: 'btc-accumulator-v2', params: { trendInterval: '1w', trendMaLen: 40, trendSlopeBars: 4 } },
  { label: 'v2 1w/30/4', def: accumulatorV2, strategyId: 'btc-accumulator-v2', params: { trendInterval: '1w', trendMaLen: 30, trendSlopeBars: 4 } },
]

const periods = ['full', 'oos', 'bear22', 'chop23', 'bull24'] as const

console.log(row(['variante', 'période', 'trades', 'WR%', 'PF', 'BTC+%', 'maxDD%', 'expo%']))
console.log('  (BTC+% = BTC accumulé vs garder son BTC ; tendance = TF/longueurMA/déclinBougies)')
console.log()

for (const v of variants) {
  for (const periodKey of periods) {
    const range = periodKey === 'full' ? (['2020-08-01', '2026-06-09'] as [string, string]) : PERIODS[periodKey]!
    const start = Date.parse(`${range[0]}T00:00:00Z`)
    const end = Date.parse(`${range[1]}T00:00:00Z`)
    try {
      const res = await runBacktest({ config: cfg(v.strategyId, v.params, start, end), def: v.def, provider })
      const m = res.metrics
      console.log(
        row([
          v.label,
          periodKey,
          String(m.totalTrades),
          fmt(m.winRate, 0),
          fmt(m.profitFactor ?? 0),
          fmt(m.netProfitPct, 2),
          fmt(-m.maxDrawdownPct, 1),
          fmt(m.exposurePct, 0),
        ]) + (res.haltedReason ? ` ⚠ ${res.haltedReason}` : ''),
      )
    } catch (err) {
      console.log(`${v.label} [${periodKey}] ERREUR: ${err instanceof Error ? err.message : err}`)
    }
  }
  console.log()
}
process.exit(0)
