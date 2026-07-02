/**
 * PSEUDO-OOS 2018 : le bear 2018 (jamais utilisé pour concevoir v1/v2 — les
 * backtests historiques démarraient 2019-01). Si l'edge « vendre en vrai bear,
 * racheter plus bas » est réel, il doit accumuler du BTC ici sans réglage.
 *
 *   bun apps/backend/src/research/accum2/oos2018.ts
 */
import { resolve } from 'node:path'
import { runBacktest, type StrategyDefinition } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import accumV1 from '../../../../../strategies/btc-accumulator'
import accumV2 from '../../../../../strategies/btc-accumulator-v2'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../../data') })

function cfg(strategyId: string, params: ParamValues, start: number, end: number): BacktestConfig {
  return {
    strategyId, params, market: 'spot', symbol: 'BTCUSDT', start, end,
    initialBalance: 1, denomination: 'base', leverage: 1,
    fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
    fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
    fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
  }
}
const f = (v: number, d = 1): string => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '—')
const W = [16, 22, 7, 5, 6, 8, 8, 8, 9]
const row = (c: string[]): string => c.map((x, i) => x.padStart(W[i] ?? 8)).join(' ')

const WINDOWS: [string, string, string][] = [
  // le cœur du test : bear 2018 (indicateurs prêts dès 2018-04-04)
  ['bear2018', '2018-05-01', '2019-01-01'],
  // variantes de bornes (sensibilité)
  ['bear2018 large', '2018-04-05', '2019-04-01'],
  ['2018→2020', '2018-05-01', '2020-01-01'],
  // toute l'histoire disponible (2017-08 + warmup → départ effectif ~2018-04)
  ['full 2018→2026', '2018-04-05', '2026-07-01'],
  // référence déjà connue pour comparaison
  ['ref 2019→2026', '2019-01-01', '2026-06-13'],
]

const strats: { label: string; def: StrategyDefinition; id: string }[] = [
  { label: 'v1 (défauts)', def: accumV1, id: 'btc-accumulator' },
  { label: 'v2 (défauts)', def: accumV2, id: 'btc-accumulator-v2' },
]

console.log(row(['stratégie', 'fenêtre', 'trades', 'WR%', 'PF', 'BTC+%', 'maxDD%', 'pire tr', 'prix±%']))
for (const s of strats) {
  for (const [label, a, b] of WINDOWS) {
    const start = Date.parse(`${a}T00:00:00Z`)
    const end = Date.parse(`${b}T00:00:00Z`)
    try {
      const res = await runBacktest({ config: cfg(s.id, {}, start, end), def: s.def, provider })
      const m = res.metrics
      const tr = res.trades.filter((t) => t.exitTime !== null)
      const worst = tr.length ? Math.min(...tr.map((t) => t.realizedPnlPct)) : 0
      // variation du prix sur la fenêtre (contexte marché)
      const cs = await provider.getCandles('spot', 'BTCUSDT', '1d', start, end)
      const px = cs.length > 1 ? ((cs[cs.length - 1]!.close - cs[0]!.close) / cs[0]!.close) * 100 : 0
      console.log(
        row([
          s.label, label, String(m.totalTrades), f(m.winRate, 0), f(m.profitFactor ?? 0, 2),
          f(m.netProfitPct, 2), f(-m.maxDrawdownPct, 1), f(worst, 1), f(px, 0),
        ]) + (res.haltedReason ? ` ⚠ ${res.haltedReason}` : ''),
      )
    } catch (err) {
      console.log(`${s.label} [${label}] ERREUR: ${err instanceof Error ? err.message : err}`)
    }
  }
  console.log()
}
process.exit(0)
