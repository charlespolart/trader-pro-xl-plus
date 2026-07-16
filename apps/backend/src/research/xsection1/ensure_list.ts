/** Télécharge le spot 2019-01→now pour chaque symbole du fichier
 *  $SYMBOLS_FILE (un par ligne), à l'interval $INTERVAL (défaut 1d).
 *  Erreurs tolérées (symbole ignoré). */
import { readFileSync } from 'node:fs'
import { CandleStore } from '@tpx/data'
import { createDb } from '@tpx/db'
import type { Interval } from '@tpx/shared'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5438/tpx')
const store = new CandleStore(db)
const START = Date.parse('2019-01-01T00:00:00Z')
const END = Date.now()
const interval = (process.env.INTERVAL ?? '1d') as Interval
const syms = readFileSync(process.env.SYMBOLS_FILE ?? '/tmp/universe_usdt.txt', 'utf8')
  .split('\n').map((s) => s.trim()).filter(Boolean)

let done = 0
for (const symbol of syms) {
  try {
    await store.ensureRange('spot', symbol, interval, START, END, {})
  } catch (err) {
    console.log(`${symbol}: ERREUR ${err instanceof Error ? err.message.slice(0, 50) : err}`)
  }
  done++
  if (done % 20 === 0) console.log(`${done}/${syms.length}`)
}
console.log(`univers ${interval} terminé (${done} symboles)`)
process.exit(0)
