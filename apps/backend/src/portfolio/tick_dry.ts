/** Phase A — TICK DU SOIR en DRY-RUN : ce que le PortfolioRunner déciderait
 *  aujourd'hui, sans rien exécuter. Données = base recherche + CSV canonique.
 *    bun apps/backend/src/portfolio/tick_dry.ts */
import postgres from 'postgres'
import { createDb } from '@tpx/db'
import { fundingCsvPath, DB_URL } from '../research/portfolio-bt/data'
import { PortfolioDataFeed } from './dataFeed'
import { gateValue, regime1Targets } from './targets'
import { GATE_BPS } from '../research/portfolio-bt/regime1'

const sql = postgres(DB_URL, { max: 4, prepare: false })
const db = createDb(DB_URL)
const feed = new PortfolioDataFeed({ sql, db, fundingCsv: fundingCsvPath() })

const fresh = process.argv.includes('fresh')
if (fresh) {
  const key = (await import('node:fs')).readFileSync(
    new URL('../../.env', import.meta.url), 'utf8',
  ).split('\n').find((l) => l.startsWith('COINALYZE_API_KEY='))?.split('=')[1]?.trim()
  if (!key) throw new Error('COINALYZE_API_KEY introuvable')
  const syms = await feed.universe()
  console.log(`funding frais via Coinalyze (${syms.length + 1} perps, batches de 20)…`)
  const r = await feed.ensureFreshFunding(syms, key)
  console.log(`funding frais : ${r.ok} séries, ${r.errors} erreurs ; purge pseudo : ${await feed.reconcileFunding()}`)
}

const { ctx } = await feed.loadContext(fresh ? 'table' : 'csv')
const day = new Date(ctx.spot.ts[ctx.t]).toISOString().slice(0, 10)
console.log(`=== tick dry-run — dernier jour de données : ${day} ===`)

const g = gateValue(ctx)
console.log(`porte regime1 : médiane funding éligibles = ${(g * 1e4).toFixed(2)} bps/j (seuil ${GATE_BPS})`)
const tg = regime1Targets(ctx, true, null)
console.log(`décision : ${tg.note}`)
if (tg.weights.size > 0) {
  const shorts = [...tg.weights.entries()].slice(0, 12)
  console.log(`cibles (extrait) : ${shorts.map(([s, w]) => `${s} ${(w * 100).toFixed(2)}%`).join(', ')}${tg.weights.size > 12 ? ` … +${tg.weights.size - 12}` : ''}`)
  console.log(`+ BTC long ${(tg.btc * 100).toFixed(0)}% de la sleeve`)
}

await sql.end()
process.exit(0)
