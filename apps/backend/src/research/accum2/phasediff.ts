/**
 * Diff trade-à-trade : v2 native (3d Binance) vs réplique resamplée offset=1.
 * Localise la 1ʳᵉ divergence pour comprendre l'écart de parité.
 *   bun apps/backend/src/research/accum2/phasediff.ts
 */
import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import accumV2 from '../../../../../strategies/btc-accumulator'
import { phaseStrategy } from './phasestrat'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../../data') })

function cfg(strategyId: string, params: ParamValues, start: number, end: number): BacktestConfig {
  return {
    strategyId, params, market: 'spot', symbol: 'BTCUSDT', start, end,
    initialBalance: 1, denomination: 'base', leverage: 1,
    fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
    fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
    fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 1000,
  }
}

const START = Date.parse('2019-01-01T00:00:00Z')
const END = Date.parse('2020-08-01T00:00:00Z')
const d = (t: number | null | undefined): string => (t == null ? '—'.padEnd(16) : new Date(t).toISOString().slice(0, 16))

const nat = await runBacktest({ config: cfg('btc-accumulator-v2', {}, START, END), def: accumV2, provider })
const rep = await runBacktest({ config: cfg('v2-phase', { phaseOffset: 1 }, START, END), def: phaseStrategy, provider })
const nt = nat.trades.filter((t) => t.exitTime !== null)
const rt = rep.trades.filter((t) => t.exitTime !== null)
console.log(`native ${nt.length} trades | resample ${rt.length} trades`)
console.log('native (entrée → sortie, pnl%)'.padEnd(48) + 'resample offset=1')
const n = Math.max(nt.length, rt.length)
for (let i = 0; i < n; i++) {
  const a = nt[i]
  const b = rt[i]
  const fa = a ? `${d(a.entryTime)} → ${d(a.exitTime)} ${(a.realizedPnlPct >= 0 ? '+' : '') + a.realizedPnlPct.toFixed(2)}%` : ''
  const fb = b ? `${d(b.entryTime)} → ${d(b.exitTime)} ${(b.realizedPnlPct >= 0 ? '+' : '') + b.realizedPnlPct.toFixed(2)}%` : ''
  const diverge = a && b && (a.entryTime !== b.entryTime || a.exitTime !== b.exitTime) ? '  <<<' : ''
  console.log(fa.padEnd(48) + fb + diverge)
}
process.exit(0)
