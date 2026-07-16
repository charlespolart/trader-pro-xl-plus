/** regime1 étape 6 — klines 1d um-futures (Vision) pour la réplication
 *  vrais prix perps du survivant G2,5/C3. Symboles = perp_symbols.txt
 *  (funding ∩ univers spot + BTCUSDT). Erreurs tolérées (symbole ignoré),
 *  queue REST géo-bloquée tolérée par candleStore (tail skipped). */
import { readFileSync } from 'node:fs'
import { CandleStore } from '@tpx/data'
import { createDb } from '@tpx/db'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5438/tpx')
const store = new CandleStore(db)
const START = Date.parse('2020-01-01T00:00:00Z')
const END = Date.now()
const file = process.env.SYMBOLS_FILE ?? new URL('./perp_symbols.txt', import.meta.url).pathname
const syms = readFileSync(file, 'utf8')
  .split('\n').map((s) => s.trim()).filter(Boolean)

let done = 0
for (const symbol of syms) {
  try {
    await store.ensureRange('futures', symbol, '1d', START, END, {})
  } catch (err) {
    console.log(`${symbol}: ERREUR ${err instanceof Error ? err.message.slice(0, 60) : err}`)
  }
  done++
  if (done % 20 === 0) console.log(`${done}/${syms.length}`)
}
console.log(`perps 1d terminé (${done} symboles)`)
process.exit(0)
