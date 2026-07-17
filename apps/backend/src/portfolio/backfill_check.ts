/** Phase B — backfill des VRAIS événements funding (Vision) sur juin 2026
 *  puis parité table↔CSV canonique (barre ≈ 0 divergence).
 *    bun apps/backend/src/portfolio/backfill_check.ts */
import postgres from 'postgres'
import { createDb } from '@tpx/db'
import { FundingStore } from '@tpx/data'
import { DB_URL, fundingCsvPath } from '../research/portfolio-bt/data'
import { PortfolioDataFeed } from './dataFeed'

const sql = postgres(DB_URL, { max: 4, prepare: false })
const db = createDb(DB_URL)
const feed = new PortfolioDataFeed({ sql, db })
const store = new FundingStore(db)

const syms = await feed.universe()
const A = Date.parse('2026-06-01T00:00:00Z')
const B = Date.parse('2026-07-01T00:00:00Z')
let ok = 0
let err = 0
for (const [i, s] of syms.entries()) {
  try {
    await store.ensureRange(s, A, B)
    ok++
  } catch {
    err++
  }
  if ((i + 1) % 50 === 0) console.log(`backfill ${i + 1}/${syms.length}`)
}
console.log(`backfill juin : ${ok} ok, ${err} sans données/erreur`)
const purged = await feed.reconcileFunding()
console.log(`pseudo-événements purgés (couverts par Vision) : ${purged}`)
const cmp = await feed.compareFundingSources(fundingCsvPath())
console.log(`parité funding table↔CSV : ${cmp.common} jours communs, ${cmp.mismatches} divergences → ${cmp.mismatches === 0 ? 'PARITÉ ✓' : 'À INVESTIGUER ✗'}`)
await sql.end()
process.exit(0)
