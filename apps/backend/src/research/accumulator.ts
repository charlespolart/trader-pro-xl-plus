/**
 * Backtest du BTC Accumulator en dénomination BASE (BTC) sur plusieurs
 * régimes. Mesure : combien de BTC accumulés vs « garder son BTC » (= 0 %).
 *
 *   bun apps/backend/src/research/accumulator.ts
 */
import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import accumulator from '../../../../strategies/btc-accumulator'
import { PERIODS } from './run'

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
const W = [26, 8, 7, 6, 6, 8, 8, 7]
const row = (c: string[]): string => c.map((x, i) => x.padStart(W[i] ?? 8)).join(' ')

const variants: { label: string; params: ParamValues }[] = [
  { label: 'défaut (sans pente)', params: {} },
  { label: 'pente7j', params: { htfSlopeDays: 7 } },
  { label: 'pente14j', params: { htfSlopeDays: 14 } },
  { label: 'pente30j', params: { htfSlopeDays: 30 } },
  { label: 'pente14j-er.45', params: { htfSlopeDays: 14, erMin: 0.45 } },
  { label: 'pente14j-ema100', params: { htfSlopeDays: 14, emaLen: 100 } },
  { label: 'pente30j-er.45', params: { htfSlopeDays: 30, erMin: 0.45 } },
]

console.log(row(['stratégie', 'période', 'trades', 'WR%', 'PF', 'BTC+%', 'maxDD%', 'expo%']))
console.log('  (BTC+% = BTC accumulé vs garder son BTC ; un nombre positif = on a plus de BTC qu’au départ)')

for (const v of variants) {
  for (const periodKey of ['full', 'is', 'oos', 'bull21', 'bear22', 'chop23', 'bull24'] as const) {
    const range = periodKey === 'full' ? (['2020-08-01', '2026-06-09'] as [string, string]) : PERIODS[periodKey]!
    const start = Date.parse(`${range[0]}T00:00:00Z`)
    const end = Date.parse(`${range[1]}T00:00:00Z`)
    try {
      const res = await runBacktest({ config: cfg(v.params, start, end), def: accumulator, provider })
      const m = res.metrics
      console.log(
        row([
          `${v.label}`,
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
