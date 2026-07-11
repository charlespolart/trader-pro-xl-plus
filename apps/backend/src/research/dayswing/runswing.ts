/**
 * Phase 2 — backtest engine de strategies/btc-swing.ts sur l'IS + par année,
 * avec valeur marginale des greffes (maker × weekend en 2×2, fenêtre NY en
 * info). Coûts réels OKX spot (maker 0,08 % / taker 0,10 %) + slip 0,05 %.
 *   bun apps/backend/src/research/dayswing/runswing.ts [--from=2019-01-01] [--to=2025-01-01]
 */
import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import swing from '../../../../../strategies/btc-swing'

const arg = (name: string, dflt: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? dflt
const FROM = arg('from', '2019-01-01')
const TO = arg('to', '2025-01-01')

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../data') })

function cfg(start: string, end: string, params: ParamValues): BacktestConfig {
  return {
    strategyId: 'btc-swing', params, market: 'spot', symbol: 'BTCUSDT',
    start: Date.parse(`${start}T00:00:00Z`), end: Date.parse(`${end}T00:00:00Z`),
    initialBalance: 10_000, denomination: 'quote', leverage: 1,
    fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
    fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
    fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
  }
}

const f = (v: number, d = 1): string => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '—')
async function run(label: string, start: string, end: string, params: ParamValues): Promise<void> {
  const res = await runBacktest({ config: cfg(start, end, params), def: swing, provider })
  const m = res.metrics
  const years = (Date.parse(end) - Date.parse(start)) / (365.25 * 86_400_000)
  console.log(
    label.padEnd(34) +
      `net ${f(m.netProfitPct).padStart(7)}%` +
      `  PF ${(m.profitFactor ?? NaN).toFixed(2).padStart(5)}` +
      `  WR ${m.winRate.toFixed(0).padStart(3)}%` +
      `  tr ${String(m.totalTrades).padStart(4)} (${(m.totalTrades / years).toFixed(0).padStart(3)}/an)` +
      `  DD ${f(m.maxDrawdownPct).padStart(6)}%` +
      `  frais ${m.totalFees.toFixed(0).padStart(5)}` +
      `  durée ${(m.avgTradeDurationMs / 3_600_000).toFixed(0).padStart(3)}h` +
      `  expo ${(m.exposurePct ?? 0).toFixed(0).padStart(3)}%` +
      (res.haltedReason ? `  ⚠ HALT: ${res.haltedReason}` : ''),
  )
}

console.log(`BTC Swing — engine, spot BTCUSDT, ${FROM} → ${TO}, coûts réels\n`)
console.log('══ IS complet — valeur marginale des greffes (2×2 maker × weekend) ══')
await run('défauts (maker ✓, weekend ✓)', FROM, TO, {})
await run('maker ✗ (taker), weekend ✓', FROM, TO, { useMakerEntry: false })
await run('maker ✓, weekend ✗', FROM, TO, { blockWeekendEntries: false })
await run('maker ✗, weekend ✗ (er-flow nu)', FROM, TO, { useMakerEntry: false, blockWeekendEntries: false })
await run('info : fenêtre NY 21→9 ON', FROM, TO, { nyWindowOnly: true })

console.log('\n══ Année par année : défauts vs er-flow nu ══')
const y0 = Number(FROM.slice(0, 4))
const y1 = Number(TO.slice(0, 4))
for (let y = y0; y < y1; y++) {
  await run(`${y} défauts`, `${y}-01-01`, `${y + 1}-01-01`, {})
  await run(`${y} nu`, `${y}-01-01`, `${y + 1}-01-01`, { useMakerEntry: false, blockWeekendEntries: false })
}
process.exit(0)
