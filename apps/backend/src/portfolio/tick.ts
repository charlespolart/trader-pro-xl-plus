/** PortfolioRunner — entrée CLI du tick quotidien (Phase A).
 *  JAMAIS lancé automatiquement : à la main ou par cron externe en Phase B.
 *    bun apps/backend/src/portfolio/tick.ts [table|csv] [dry]
 *  Env : PORTFOLIO_SLEEVE_USD (déf. 6000), PORTFOLIO_ALLOW_STALE=1 (tests). */
import postgres from 'postgres'
import { createDb } from '@tpx/db'
import { fundingCsvPath, DB_URL } from '../research/portfolio-bt/data'
import { PortfolioDataFeed } from './dataFeed'
import { PortfolioRunner, defaultPaths } from './portfolioRunner'

const source = (process.argv[2] === 'table' ? 'table' : 'csv') as 'csv' | 'table'
const mode = process.argv.includes('dry') ? 'dry' : 'paper'
const sql = postgres(DB_URL, { max: 4, prepare: false })
const db = createDb(DB_URL)
const feed = new PortfolioDataFeed({ sql, db, fundingCsv: fundingCsvPath() })
const { sendTelegram, flushTelegram } = await import('../services/telegram')
const runner = new PortfolioRunner(feed, {
  sleeveR1Usd: Number(process.env.PORTFOLIO_SLEEVE_R1_USD ?? 6000),
  sleeveL2Usd: Number(process.env.PORTFOLIO_SLEEVE_L2_USD ?? 6000),
  mode,
  ...defaultPaths(),
  telegram: process.env.PORTFOLIO_TELEGRAM === '1' ? sendTelegram : undefined,
})
await runner.tick(source)
await sql.end()
// le résumé (5 messages) passe par la file sérialisée : sans ce flush,
// process.exit tue les envois en vol (nuit du 2026-07-19 : tick parfait,
// messages perdus/désordonnés). Cap généreux : pas de deadline de kill ici
// (conteneur éphémère qui sort de lui-même).
await flushTelegram(15_000)
process.exit(0)
