/** H1 — alts USDT liquides : 1h/4h/1d (+3d/1w agrégés au besoin), 2019-01→now.
 *  DATABASE_URL=postgres://tpx:tpx@localhost:5438/tpx bun apps/backend/src/research/audit1/ensure_alts.ts */
import { CandleStore } from '@tpx/data'
import { createDb } from '@tpx/db'
import type { Interval } from '@tpx/shared'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5438/tpx')
const store = new CandleStore(db)
const START = Date.parse('2019-01-01T00:00:00Z')
const END = Date.now()
const ALTS = ['BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT', 'LTCUSDT', 'MATICUSDT', 'ATOMUSDT', 'UNIUSDT', 'NEARUSDT', 'FILUSDT', 'ETCUSDT', 'XLMUSDT', 'ALGOUSDT', 'VETUSDT', 'TRXUSDT', 'EOSUSDT']

for (const symbol of ALTS) {
  for (const interval of ['1d', '4h', '1h'] as Interval[]) {
    try {
      await store.ensureRange('spot', symbol, interval, START, END, {})
      const rows = await store.getCandles('spot', symbol, interval, START, END)
      console.log(`${symbol} ${interval}: ${rows.length}`)
    } catch (err) {
      console.log(`${symbol} ${interval}: ERREUR ${err instanceof Error ? err.message.slice(0, 60) : err}`)
    }
  }
}
console.log('alts terminé')
process.exit(0)
