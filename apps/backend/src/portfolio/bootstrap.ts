/** PortfolioRunner — BOOTSTRAP des données sur une base vierge (VPS).
 *  La base prod ne contient que les paires des bots live : ce script
 *  télécharge l'historique nécessaire au runner (closes 1d spot+perp de
 *  l'univers depuis 2025-01, funding depuis 2026-04) via Vision — puis le
 *  refresh nocturne entretient. Idempotent, relançable.
 *  L'univers vient du fichier universe.txt (exporté de la base recherche —
 *  la base prod ne peut pas le déduire avant d'avoir l'historique).
 *    bun apps/backend/src/portfolio/bootstrap.ts */
import { readFileSync } from 'node:fs'
import postgres from 'postgres'
import { createDb } from '@tpx/db'
import { CandleStore, FundingStore } from '@tpx/data'
import { DB_URL } from '../research/portfolio-bt/data'

const CANDLES_FROM = Date.parse('2025-01-01T00:00:00Z')
const FUNDING_FROM = Date.parse('2026-04-01T00:00:00Z')

const sql = postgres(DB_URL, { max: 2, prepare: false })
const db = createDb(DB_URL)
const candles = new CandleStore(db)
const funding = new FundingStore(db)

const syms = readFileSync(new URL('./universe.txt', import.meta.url), 'utf8')
  .split('\n').map((s) => s.trim()).filter(Boolean)
console.log(`bootstrap : ${syms.length} symboles (candles dès 2025-01, funding dès 2026-04)`)
const end = Date.now()
let done = 0
for (const symbol of [...syms, 'BTCUSDT']) {
  try {
    await candles.ensureRange('spot', symbol, '1d', CANDLES_FROM, end, {})
    await candles.ensureRange('futures', symbol, '1d', CANDLES_FROM, end, {}).catch(() => {})
    await funding.ensureRange(symbol, FUNDING_FROM, end).catch(() => {})
  } catch (err) {
    console.log(`${symbol}: ERREUR ${err instanceof Error ? err.message.slice(0, 50) : err}`)
  }
  done++
  if (done % 25 === 0) console.log(`${done}/${syms.length + 1}`)
}
const n = await sql.unsafe(`SELECT count(DISTINCT symbol) AS n FROM candles WHERE market='spot' AND interval='1d'`)
console.log(`bootstrap terminé — ${n[0].n} symboles spot en base`)
await sql.end()
process.exit(0)
