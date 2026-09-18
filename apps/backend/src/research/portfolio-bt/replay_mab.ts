/** portfolio-bt — REJEU de la marche à blanc (revue §5.2, GO Mario 2026-09-03).
 *
 *  Recalcule jour par jour, avec le MÊME code que le runner VPS
 *  (portfolio/targets.ts : gateValue + regime1Targets, ancre K7 du state)
 *  mais depuis un pipeline de données INDÉPENDANT (base recherche 5438
 *  re-téléchargée de Vision/Coinalyze), les décisions de la fenêtre de
 *  marche à blanc — puis compare aux décisions LOGGÉES par le VPS :
 *  mêmes portes (au centième de bps), même décision ON/OFF aux rebals,
 *  même sélection au dernier rebal (87 jambes du state).
 *
 *    bun apps/backend/src/research/portfolio-bt/replay_mab.ts \
 *      [fenetre_debut=2026-07-16] [fenetre_fin=2026-09-02]
 *
 *  Entrée VPS : $MAB_REVIEW (défaut /tmp/mab-review.txt) (lignes « 📊 regime1 … »
 *  + state JSON) — produite par la session de revue (lecture seule VPS).
 */
import { connect, loadPanel, universeSymbols, DAY } from './data'
import { histFinite } from './regime1'
import { gateValue, regime1Targets, type DayContext, type TargetWeights } from '../../portfolio/targets'
import { PortfolioDataFeed } from '../../portfolio/dataFeed'
import { createDb } from '@tpx/db'
import { readFileSync } from 'node:fs'

const START = Date.parse(`${process.argv[2] ?? '2026-07-16'}T00:00:00Z`)
const END = Date.parse(`${process.argv[3] ?? '2026-09-02'}T00:00:00Z`)
const ANCHOR = 1784160000000 // anchorTs du state VPS (2026-07-16)

// ---- données (base recherche, pipeline indépendant, source 'table')
const sql = connect()
const db = createDb(process.env.RESEARCH_DB ?? 'postgres://tpx:tpx@localhost:5438/tpx')
const feed = new PortfolioDataFeed({ sql, db })
const syms = await universeSymbols(sql)
const spot = await loadPanel(sql, syms, 'spot')
const perp = await loadPanel(sql, syms, 'futures', spot.ts)
const fund = await feed.loadFundingFromTable([...syms, 'BTCUSDT'], spot.ts)
const hist = histFinite(spot)
console.log(`univers ${syms.length} · panel n=${spot.n} (${new Date(spot.ts[0]!).toISOString().slice(0, 10)} → ${new Date(spot.ts[spot.n - 1]!).toISOString().slice(0, 10)})`)

// ---- décisions VPS (log + state récoltés en lecture seule)
const vps = readFileSync(process.env.MAB_REVIEW ?? '/tmp/mab-review.txt', 'utf8')
const vpsGates = new Map<string, { g: number; rebal: boolean; on: boolean }>()
for (const m of vps.matchAll(/regime1 (\d{4}-\d\d-\d\d) — porte ([\d.]+) bps\/j.*?· (REBAL|tenue) · porte (ON|OFF)/g)) {
  vpsGates.set(m[1]!, { g: Number(m[2]), rebal: m[3] === 'REBAL', on: m[4] === 'ON' })
}
const state = JSON.parse(vps.slice(vps.indexOf('=== state ===') + 14, vps.indexOf('\n}', vps.indexOf('=== state ===')) + 2))
const vpsSel = new Map<string, number>(state.regime1.lastTargets.weights)
console.log(`décisions VPS : ${vpsGates.size} jours de porte, sélection du dernier rebal : ${vpsSel.size} jambes`)

// ---- rejeu jour par jour (même ancre, même persistance hors-rebal)
let prev: TargetWeights | null = null
let diffs = 0
let compared = 0
let lastRebalSel: TargetWeights | null = null
for (let t = 0; t < spot.n; t++) {
  const ts = spot.ts[t]!
  if (ts < START || ts > END) continue
  const day = new Date(ts).toISOString().slice(0, 10)
  const ctx: DayContext = { t, spot, perp, fund, hist }
  const isRebal = Math.round((ts - ANCHOR) / DAY) % 7 === 0
  const g = gateValue(ctx)
  const tg = regime1Targets(ctx, isRebal, prev)
  prev = tg
  if (isRebal && tg.weights.size > 0) lastRebalSel = tg
  const v = vpsGates.get(day)
  if (!v) continue
  compared++
  const gBps = g * 1e4
  const gateOk = Math.abs(gBps - v.g) <= 0.005
  const rebalOk = isRebal === v.rebal
  const onOk = (tg.weights.size > 0 || tg.btc !== 0) === v.on
  if (!gateOk || !rebalOk || !onOk) {
    diffs++
    console.log(
      `✗ ${day} — porte rejeu ${gBps.toFixed(2)} vs VPS ${v.g.toFixed(2)}${gateOk ? '' : ' ≠'} | ` +
        `rebal ${isRebal}/${v.rebal}${rebalOk ? '' : ' ≠'} | ON ${tg.weights.size > 0}/${v.on}${onOk ? '' : ' ≠'}`,
    )
  }
}
console.log(`\nportes comparées : ${compared} jours — divergences : ${diffs}`)

// ---- sélection du dernier rebal vs state VPS
if (lastRebalSel) {
  const mine = new Set(lastRebalSel.weights.keys())
  const theirs = new Set(vpsSel.keys())
  const missing = [...theirs].filter((s) => !mine.has(s))
  const extra = [...mine].filter((s) => !theirs.has(s))
  console.log(
    `sélection dernier rebal : rejeu ${mine.size} vs VPS ${theirs.size} — ` +
      `recouvrement ${theirs.size - missing.length}/${theirs.size}` +
      (missing.length ? ` | manquants rejeu: ${missing.slice(0, 6).join(',')}` : '') +
      (extra.length ? ` | en trop rejeu: ${extra.slice(0, 6).join(',')}` : ''),
  )
  console.log(`note rejeu : ${lastRebalSel.note}`)
} else {
  console.log('aucun rebal ON dans la fenêtre rejouée')
}
await sql.end()
process.exit(0)
