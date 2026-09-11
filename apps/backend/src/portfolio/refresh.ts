/** PortfolioRunner — refresh nocturne des données (Phase B, LOCAL).
 *  0) DÉCOUVERTE des nouveaux listings spot Binance (exchangeInfo vs base) —
 *     sans elle l'univers est figé et listing2 est aveugle (bêtisier n°12) ;
 *  1) closes 1d spot+perp de l'univers + des symboles récents (Vision) ;
 *  2) funding frais Coinalyze (jours pré-archivage) + purge des pseudo-
 *     événements couverts par Vision.  bun apps/backend/src/portfolio/refresh.ts */
import { readFileSync } from 'node:fs'
import postgres from 'postgres'
import { createDb } from '@tpx/db'
import { DB_URL } from '../research/portfolio-bt/data'
import { PortfolioDataFeed } from './dataFeed'

const sql = postgres(DB_URL, { max: 4, prepare: false })
const db = createDb(DB_URL)
const feed = new PortfolioDataFeed({ sql, db })

const t0 = Date.now()
const universe = await feed.universe()
// la découverte est RÉSEAU : son échec ne doit jamais faire sauter le tick
let discovered: string[] = []
try {
  discovered = await feed.discoverNewSpotSymbols()
} catch (err) {
  console.log(`⚠ découverte des nouveaux listings en échec (ignorée) : ${err instanceof Error ? err.message.slice(0, 80) : err}`)
}
const fresh = await feed.freshSymbols()
const syms = [...new Set([...universe, ...fresh])]
console.log(
  `refresh — univers ${universe.length} symboles + ${fresh.length} récents` +
    (discovered.length ? ` (découverts cette nuit : ${discovered.slice(0, 8).join(', ')}${discovered.length > 8 ? '…' : ''})` : ''),
)
const c = await feed.ensureFresh(syms)
console.log(`candles+funding Vision : ${c.ok} ok, ${c.errors.length} erreurs${c.errors.length ? ` (ex: ${c.errors[0]})` : ''}`)

const key = process.env.COINALYZE_API_KEY
  ?? readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').find((l) => l.startsWith('COINALYZE_API_KEY='))?.split('=')[1]?.trim()
if (key) {
  const f = await feed.ensureFreshFunding(syms, key)
  const purged = await feed.reconcileFunding()
  console.log(`funding Coinalyze : ${f.ok} séries, ${f.errors} erreurs ; pseudo purgés : ${purged}`)
} else {
  console.log('⚠ COINALYZE_API_KEY absente — funding frais sauté')
}
console.log(`refresh terminé en ${((Date.now() - t0) / 60000).toFixed(1)} min`)
await sql.end()
process.exit(0)
