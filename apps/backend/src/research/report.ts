/**
 * Point de perf + RISQUE sur BTC Accumulator v2 (défauts).
 *   bun apps/backend/src/research/report.ts
 */
import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import accumV2 from '../../../../strategies/btc-accumulator-v2'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../data') })

function cfg(params: ParamValues, a: string, b: string): BacktestConfig {
  return {
    strategyId: 'btc-accumulator-v2', params, market: 'spot', symbol: 'BTCUSDT',
    start: Date.parse(`${a}T00:00:00Z`), end: Date.parse(`${b}T00:00:00Z`),
    initialBalance: 1, denomination: 'base', leverage: 1,
    fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
    fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
    fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
  }
}
const f = (v: number, d = 1): string => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '—')

for (const [label, a, b] of [
  ['2019→2026 (réaliste, inclut 2019-20)', '2019-01-01', '2026-06-13'],
  ['2020-08→2026 (warmup propre)', '2020-08-01', '2026-06-09'],
] as const) {
  const res = await runBacktest({ config: cfg({}, a, b), def: accumV2, provider })
  const m = res.metrics
  const tr = res.trades.filter((t) => t.exitTime !== null).sort((x, y) => x.exitTime! - y.exitTime!)
  const wins = tr.filter((t) => t.realizedPnl > 0)
  const losses = tr.filter((t) => t.realizedPnl <= 0)
  const avg = (arr: number[]): number => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0)
  const avgWin = avg(wins.map((t) => t.realizedPnlPct))
  const avgLoss = avg(losses.map((t) => t.realizedPnlPct))
  const worstLoss = Math.min(0, ...tr.map((t) => t.realizedPnlPct))
  const bestWin = Math.max(0, ...tr.map((t) => t.realizedPnlPct))
  // plus longue séquence de pertes consécutives + sa perte cumulée (~% composé)
  let streak = 0, maxStreak = 0, curLossPct = 0, worstStreakPct = 0
  for (const t of tr) {
    if (t.realizedPnl <= 0) {
      streak++; curLossPct += t.realizedPnlPct
      maxStreak = Math.max(maxStreak, streak)
      worstStreakPct = Math.min(worstStreakPct, curLossPct)
    } else { streak = 0; curLossPct = 0 }
  }
  const payoff = avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : Infinity
  const wr = wins.length / Math.max(1, tr.length)
  const expectancy = wr * avgWin + (1 - wr) * avgLoss
  const capped = tr.filter((t) => t.realizedPnlPct <= -4.5).length

  console.log(`\n=== ${label} ===`)
  console.log(`  BTC accumulé (vs garder)   : ${f(m.netProfitPct, 2)} %`)
  console.log(`  trades / win rate / PF      : ${tr.length} / ${(wr * 100).toFixed(0)}% / ${f(m.profitFactor ?? 0, 2)}`)
  console.log(`  max drawdown (BTC)          : ${f(-m.maxDrawdownPct, 1)} %`)
  console.log(`  expo (temps en USDT)        : ${f(m.exposurePct, 0)} %`)
  console.log(`  gain moyen / perte moyenne  : ${f(avgWin, 1)}% / ${f(avgLoss, 1)}%   (payoff ${payoff.toFixed(2)}:1)`)
  console.log(`  meilleur / pire trade       : ${f(bestWin, 1)}% / ${f(worstLoss, 1)}%   (cap perte = 5%)`)
  console.log(`  trades au plafond de perte  : ${capped}/${tr.length}`)
  console.log(`  espérance / trade           : ${f(expectancy, 2)}%`)
  console.log(`  + longue série de pertes    : ${maxStreak} d'affilée  (cumul ~${f(worstStreakPct, 1)}% sur la série)`)
}
process.exit(0)
