/** PortfolioRunner — refresh nocturne des données (Phase B, LOCAL).
 *  1) closes 1d spot+perp de l'univers (candleStore/Vision, incrémental) ;
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
const syms = await feed.universe()
console.log(`refresh — univers ${syms.length} symboles`)
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
