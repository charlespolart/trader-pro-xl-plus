/**
 * Diagnostic : pourquoi le backtest UI de v2 (2019→2026) rend +60% / -44% DD
 * alors que la recherche (2020-08→2026) montrait +160% / -25% DD ?
 * Hypothèse : la date de DÉBUT (2019 = reprise ×4 + crash covid) plombe un
 * récolteur de bear. On vérifie : repro exacte, compare v1/v2 sur 2 fenêtres,
 * décompose année par année, et localise le pire drawdown.
 *
 *   bun apps/backend/src/research/accumv2diag.ts
 */
import { resolve } from 'node:path'
import { runBacktest, type StrategyDefinition } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import accumV1 from '../../../../strategies/btc-accumulator'
import accumV2 from '../../../../strategies/btc-accumulator-v2'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../data') })

function cfg(strategyId: string, params: ParamValues, start: number, end: number): BacktestConfig {
  return {
    strategyId, params, market: 'spot', symbol: 'BTCUSDT', start, end,
    initialBalance: 1, denomination: 'base', leverage: 1,
    fees: { ...DEFAULT_FEES.spot, bnbDiscount: false }, slippagePct: 0.0005,
    fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
    fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
  }
}
const D = (s: string): number => Date.parse(`${s}T00:00:00Z`)
const f = (v: number, d = 1): string => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '—')

async function run(def: StrategyDefinition, id: string, params: ParamValues, start: string, end: string) {
  return runBacktest({ config: cfg(id, params, D(start), D(end)), def, provider })
}

// ---- 1) repro + comparaison v1/v2 sur les deux fenêtres
console.log('=== Comparaison (BTCUSDT spot, base, défauts) ===')
console.log('strat  fenêtre                trades   net%    maxDD%   PF')
for (const [label, id, def] of [['v1', 'btc-accumulator', accumV1], ['v2', 'btc-accumulator-v2', accumV2]] as const) {
  for (const [a, b] of [['2019-01-01', '2026-06-13'], ['2020-08-01', '2026-06-09']] as const) {
    const r = await run(def, id, {}, a, b)
    const m = r.metrics
    console.log(`${label.padEnd(6)} ${a}→${b}  ${String(m.totalTrades).padStart(5)}  ${f(m.netProfitPct).padStart(7)}  ${f(-m.maxDrawdownPct).padStart(7)}  ${f(m.profitFactor ?? 0, 2).padStart(5)}`)
  }
}

// ---- 2) décomposition année par année (v2 défauts), chaque année en standalone
console.log('\n=== v2 défauts — année par année (capital 1 BTC remis à chaque année) ===')
console.log('année   trades   net%   maxDD%   expo%')
for (let y = 2019; y <= 2025; y++) {
  const r = await run(accumV2, 'btc-accumulator-v2', {}, `${y}-01-01`, `${y + 1}-01-01`)
  const m = r.metrics
  console.log(`${y}    ${String(m.totalTrades).padStart(6)}  ${f(m.netProfitPct).padStart(6)}  ${f(-m.maxDrawdownPct).padStart(6)}  ${f(m.exposurePct, 0).padStart(5)}`)
}

// ---- 3) localisation du pire drawdown sur le run 2019→2026 (v2 défauts)
const full = await run(accumV2, 'btc-accumulator-v2', {}, '2019-01-01', '2026-06-13')
const eq = full.equity
let worst = { dd: -1, time: 0, equity: 0 }
for (const p of eq) if (p.drawdownPct > worst.dd) worst = { dd: p.drawdownPct, time: p.time, equity: p.equity }
// retrouver le pic précédant le creux
let peakTime = 0, peakEq = 0
for (const p of eq) { if (p.time > worst.time) break; if (p.equity >= peakEq) { peakEq = p.equity; peakTime = p.time } }
const iso = (t: number): string => new Date(t).toISOString().slice(0, 10)
console.log('\n=== Pire drawdown (v2 défauts, 2019→2026) ===')
console.log(`pic ${iso(peakTime)} (${peakEq.toFixed(4)} BTC) → creux ${iso(worst.time)} (${worst.equity.toFixed(4)} BTC) = ${f(-worst.dd)}%`)

// ---- 4) pires trades (BTC perdu) sur le run complet
const losers = [...full.trades]
  .filter((t) => t.exitTime !== null)
  .sort((a, b) => a.realizedPnl - b.realizedPnl)
  .slice(0, 6)
console.log('\n=== 6 pires trades (BTC, run 2019→2026) ===')
for (const t of losers) {
  console.log(`${iso(t.entryTime)}→${t.exitTime ? iso(t.exitTime) : '…'}  vendu ${t.avgEntryPrice.toFixed(0)} → racheté ${t.avgExitPrice?.toFixed(0) ?? '—'}  P&L ${t.realizedPnl >= 0 ? '+' : ''}${t.realizedPnl.toFixed(5)} BTC`)
}
process.exit(0)
