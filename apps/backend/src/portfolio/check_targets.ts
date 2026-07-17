/** Phase A / lot A1 — test croisé : les cibles produites par targets.ts
 *  (chemin RUNNER) doivent être IDENTIQUES à la sélection du backtest
 *  portfolio-bt (chemin VALIDATION) aux mêmes dates de rebalancement.
 *    bun apps/backend/src/portfolio/check_targets.ts */
import { connect, fundingCsvPath, loadFunding, loadPanel, universeSymbols } from '../research/portfolio-bt/data'
import { IS_START, OOS_END, searchsorted } from '../research/portfolio-bt/engine'
import { gateSeries, histFinite, signalFlevel } from '../research/portfolio-bt/regime1'
import { GATE_BPS, K } from '../research/portfolio-bt/regime1'
import { MIN_ALIVE, TOPQ, WARMUP } from '../research/portfolio-bt/data'
import { argsortAsc } from '../research/portfolio-bt/engine'
import { regime1Targets, type DayContext } from './targets'

const sql = connect()
const syms = await universeSymbols(sql)
const spot = await loadPanel(sql, syms, 'spot')
const perp = await loadPanel(sql, syms, 'futures', spot.ts)
const fund = loadFunding(fundingCsvPath(), syms, spot.ts)
const hist = histFinite(spot)

// référence backtest : sélection au rebal t (mêmes briques que runRegime1)
const inp = { spot, rExec: new Float64Array(0), fund, btcR: new Float64Array(0) }
const g = gateSeries(inp as never, hist)
const S = signalFlevel(fund, spot.n, spot.na)
function backtestSelection(t: number): Set<string> {
  const out = new Set<string>()
  if (!(Number.isFinite(g[t]) && g[t] >= GATE_BPS / 1e4)) return out
  const idx: number[] = []
  for (let a = 0; a < spot.na; a++) {
    const k = t * spot.na + a
    if (Number.isFinite(S[k]) && Number.isFinite(spot.px[k]) && hist[k] >= WARMUP
      && fund.cnt[k] >= 21 && fund.lastev[k] <= 2) idx.push(a)
  }
  if (idx.length < MIN_ALIVE) return out
  const ntop = Math.max(1, Math.round(idx.length * TOPQ))
  const rowS = new Float64Array(spot.na)
  for (const a of idx) rowS[a] = S[t * spot.na + a]
  const order = argsortAsc(rowS, idx)
  for (let j = 0; j < ntop; j++) out.add(spot.syms[order[j]])
  return out
}

const lo = searchsorted(spot.ts, IS_START)
const hi = searchsorted(spot.ts, OOS_END)
let checked = 0
let mismatches = 0
for (let t = lo; t < hi; t += K) {
  const ctx: DayContext = { t, spot, perp, fund, hist }
  const got = regime1Targets(ctx, true, null)
  const want = backtestSelection(t)
  const gotSet = new Set(got.weights.keys())
  const same = gotSet.size === want.size && [...want].every((s) => gotSet.has(s))
  const btcOk = (want.size > 0) === (got.btc === 1)
  if (!same || !btcOk) {
    mismatches++
    if (mismatches <= 3) {
      console.log(`✗ t=${new Date(spot.ts[t]).toISOString().slice(0, 10)} : runner ${gotSet.size} noms vs backtest ${want.size}`)
    }
  }
  checked++
}
console.log(`rebalancements comparés : ${checked} | divergences : ${mismatches} → ${mismatches === 0 ? 'PARITÉ CIBLES ✓' : 'ÉCHEC ✗'}`)
await sql.end()
