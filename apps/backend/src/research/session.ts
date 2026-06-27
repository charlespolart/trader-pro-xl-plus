/**
 * Effet « session / heure de la journée » sur BTC.
 * A) marché : volatilité & drift par créneau 4h UTC (robuste, ~16k bougies).
 * B) strat  : les trades de la v2 ventilés par session d'entrée (caveat sample).
 *   bun apps/backend/src/research/session.ts
 */
import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import accumV2 from '../../../../strategies/btc-accumulator-v2'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../data') })

const START = Date.parse('2019-01-01T00:00:00Z')
const END = Date.parse('2026-06-13T00:00:00Z')
const f = (v: number, d = 2): string => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '—')

// libellé de session par heure UTC d'ouverture de la bougie 4h
const SESSION: Record<number, string> = {
  0: 'Asie',
  4: 'Asie→EU',
  8: 'Europe',
  12: 'EU→US (open US ~13h30)',
  16: 'US',
  20: 'US soir/Asie',
}

// ---- A) marché : par créneau 4h
const candles = await provider.getCandles('spot', 'BTCUSDT', '4h', START, END)
const slots = new Map<number, { n: number; absRet: number; ret: number; range: number; vol: number }>()
for (const c of candles) {
  const h = new Date(c.openTime).getUTCHours()
  const s = slots.get(h) ?? { n: 0, absRet: 0, ret: 0, range: 0, vol: 0 }
  const r = c.open > 0 ? Math.log(c.close / c.open) : 0
  s.n++
  s.ret += r
  s.absRet += Math.abs(r)
  s.range += c.open > 0 ? (c.high - c.low) / c.open : 0
  s.vol += c.volume
  slots.set(h, s)
}
console.log(`=== A) Marché BTC par créneau 4h UTC (${candles.length} bougies, 2019-2026) ===`)
console.log('heure UTC  session'.padEnd(34) + ['n', 'vol.moy% (|ret|)', 'range% (H-L)', 'drift moy%', 'volume rel'].map((s) => s.padStart(16)).join(''))
const totVol = [...slots.values()].reduce((a, s) => a + s.vol / s.n, 0)
for (const h of [0, 4, 8, 12, 16, 20]) {
  const s = slots.get(h)
  if (!s) continue
  const volRel = (s.vol / s.n) / (totVol / 6)
  console.log(
    `${String(h).padStart(2)}:00-${String((h + 4) % 24).padStart(2)}:00  ${SESSION[h]}`.padEnd(34) +
      [String(s.n), f((s.absRet / s.n) * 100), f((s.range / s.n) * 100), f((s.ret / s.n) * 100, 3), `×${volRel.toFixed(2)}`]
        .map((x) => x.padStart(16))
        .join(''),
  )
}

// ---- B) strat : trades par session d'entrée (caveat: ~53 trades)
function cfg(params: ParamValues): BacktestConfig {
  return {
    strategyId: 'btc-accumulator-v2', params, market: 'spot', symbol: 'BTCUSDT', start: START, end: END,
    initialBalance: 1, denomination: 'base', leverage: 1,
    fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
    fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
    fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
  }
}
const res = await runBacktest({ config: cfg({}), def: accumV2, provider })
const tr = res.trades.filter((t) => t.exitTime !== null)
const byHour = new Map<number, { n: number; wins: number; pnl: number }>()
for (const t of tr) {
  const h = new Date(t.entryTime).getUTCHours()
  const b = byHour.get(h) ?? { n: 0, wins: 0, pnl: 0 }
  b.n++
  if (t.realizedPnl > 0) b.wins++
  b.pnl += t.realizedPnlPct
  byHour.set(h, b)
}
console.log(`\n=== B) Trades v2 par heure d'entrée UTC (${tr.length} trades — ÉCHANTILLON FAIBLE, indicatif) ===`)
console.log('heure  session'.padEnd(34) + ['trades', 'win%', 'P&L moy%'].map((s) => s.padStart(12)).join(''))
for (const h of [...byHour.keys()].sort((a, b) => a - b)) {
  const b = byHour.get(h)!
  console.log(
    `${String(h).padStart(2)}:00  ${SESSION[h] ?? '—'}`.padEnd(34) +
      [String(b.n), ((b.wins / b.n) * 100).toFixed(0), f(b.pnl / b.n, 1)].map((x) => x.padStart(12)).join(''),
  )
}
process.exit(0)
