/** audit1 — debug : gain par excursion, replay vs moteur (trouver la divergence) */
import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import accumV2 from '../../../../../strategies/btc-accumulator'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5438/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../../data'), autoEnsure: false })
const START = Date.parse('2018-04-05T00:00:00Z')
const END = Date.parse('2026-07-01T00:00:00Z')
const H4 = 14_400_000
const FEE = 0.0015

const config: BacktestConfig = {
  strategyId: 'btc-accumulator-v2', params: {} as ParamValues, market: 'spot', symbol: 'BTCUSDT',
  start: START, end: END, initialBalance: 1, denomination: 'base', leverage: 1,
  fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
  fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
  fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
}
const res = await runBacktest({ config, def: accumV2, provider })
const cs = await provider.getCandles('spot', 'BTCUSDT', '4h', START - 30 * 86_400_000, END)
const idx: number[] = []
for (let i = 0; i < cs.length; i++) if (cs[i]!.openTime >= START && cs[i]!.openTime < END) idx.push(i)
const closes = idx.map((i) => cs[i]!.close)
const timeToJ = new Map<number, number>()
idx.forEach((i, j) => timeToJ.set(cs[i]!.openTime, j))

let prod = 1
let worstDiff = 0
console.log('excursion (entrée)        durée  moteur%   replay%   Δ')
for (const t of res.trades.filter((x) => x.exitTime !== null)) {
  const s = timeToJ.get(Math.floor(t.entryTime / H4) * H4)
  const d = Math.max(1, Math.round((t.exitTime! - t.entryTime) / H4))
  if (s === undefined) {
    console.log(`  !! entrée non mappée: ${new Date(t.entryTime).toISOString()}`)
    continue
  }
  let v = 1
  for (let j = s; j < Math.min(s + d, closes.length); j++) {
    v *= closes[j - 1]! / closes[j]!
  }
  v *= (1 - FEE) * (1 - FEE)
  const rep = (v - 1) * 100
  prod *= v
  const diff = rep - t.realizedPnlPct
  if (Math.abs(diff) > Math.abs(worstDiff)) worstDiff = diff
  if (Math.abs(diff) > 2) {
    console.log(
      `${new Date(t.entryTime).toISOString().slice(0, 16).padEnd(24)} ${String(d).padStart(4)}b ` +
      `${t.realizedPnlPct.toFixed(2).padStart(8)} ${rep.toFixed(2).padStart(8)} ${diff.toFixed(2).padStart(7)}  (exit: ${t.exitReason?.slice(0, 40) ?? '—'})`,
    )
  }
}
console.log(`\nproduit des replays : ${((prod - 1) * 100).toFixed(1)}% | moteur net ${res.metrics.netProfitPct.toFixed(1)}% | pire Δ ${worstDiff.toFixed(2)}pt`)
process.exit(0)
