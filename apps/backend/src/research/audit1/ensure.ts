/**
 * audit1 — bootstrap de la base de RECHERCHE (neuve, port 5438) après la
 * corruption WAL de la base dev du 2026-07-15 (disque plein).
 * Télécharge depuis Binance Vision (ZIPs mensuels/quotidiens) : BTC/ETH spot
 * 1h/4h/1d (+3d/1w auto-agrégés depuis le 1d par le candleStore).
 *   DATABASE_URL=postgres://tpx:tpx@localhost:5438/tpx bun apps/backend/src/research/audit1/ensure.ts
 */
import { CandleStore } from '@tpx/data'
import { createDb } from '@tpx/db'
import type { Interval } from '@tpx/shared'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5438/tpx')
const store = new CandleStore(db)

const START = Date.parse('2017-08-01T00:00:00Z')
const END = Date.now()

const PLAN: Array<{ symbol: string; intervals: Interval[] }> = [
  { symbol: 'BTCUSDT', intervals: ['1d', '4h', '1h', '3d', '1w'] },
  { symbol: 'ETHUSDT', intervals: ['1d', '4h', '1h', '3d', '1w'] },
]

for (const { symbol, intervals } of PLAN) {
  for (const interval of intervals) {
    const t0 = Date.now()
    let lastPct = -1
    await store.ensureRange('spot', symbol, interval, START, END, {
      onProgress: (done, total) => {
        const pct = Math.floor((done / Math.max(total, 1)) * 10) * 10
        if (pct > lastPct) {
          lastPct = pct
          process.stdout.write(`\r${symbol} ${interval}: ${pct}%   `)
        }
      },
    })
    const rows = await store.getCandles('spot', symbol, interval, START, END)
    console.log(`\r${symbol} ${interval}: ${rows.length} bougies (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
  }
}
console.log('bootstrap terminé')
process.exit(0)
