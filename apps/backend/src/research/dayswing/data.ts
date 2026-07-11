/**
 * Campagne day-swing 2026-07 : bougies fines spot pour la cartographie intraday.
 * BTCUSDT 15m (n'existe que sur 20 jours en base) + ETHUSDT 15m/1h (transfert ETH
 * de la passe de sensibilité). Le reste (1h/4h/1d BTC, 4h/1d ETH) est déjà couvert.
 *   bun apps/backend/src/research/dayswing/data.ts
 */
import { createDb } from '@tpx/db'
import { CandleStore } from '@tpx/data'
import type { Interval } from '@tpx/shared'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const store = new CandleStore(db)

const START = Date.parse('2017-08-01T00:00:00Z')
const END = Date.now()

const WANTED: Array<[string, Interval[]]> = [
  ['BTCUSDT', ['15m']],
  ['ETHUSDT', ['15m', '1h']],
]

for (const [symbol, intervals] of WANTED) {
  for (const itv of intervals) {
    let last = 0
    process.stdout.write(`spot ${symbol} ${itv} `)
    await store.ensureRange('spot', symbol, itv, START, END, {
      onProgress: (d, t) => {
        const pct = Math.floor((d / t) * 10)
        if (pct > last) {
          last = pct
          process.stdout.write('▮')
        }
      },
    })
    console.log(' ok')
  }
}
process.exit(0)
