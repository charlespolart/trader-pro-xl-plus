/** saison1/F3 — klines 1h um-futures BTC+ETH sur l'IS (contrôle positif
 *  basis + fenêtres de funding). bun ensure_1h.ts */
import { CandleStore } from '@tpx/data'
import { createDb } from '@tpx/db'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5438/tpx')
const store = new CandleStore(db)
const START = Date.parse('2019-09-01T00:00:00Z')
const END = Date.parse('2024-01-01T00:00:00Z')
for (const symbol of ['BTCUSDT', 'ETHUSDT']) {
  await store.ensureRange('futures', symbol, '1h', START, END, {})
  console.log(`${symbol} 1h futures ok`)
}
process.exit(0)
