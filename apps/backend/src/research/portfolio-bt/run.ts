/** portfolio-bt — runner de PARITÉ : rejoue les deux candidats en TS et
 *  compare aux chiffres python de validation (la barre de vérité).
 *    bun apps/backend/src/research/portfolio-bt/run.ts */
import { connect, fundingCsvPath, loadBtcReturns, loadFunding, loadPanel, universeSymbols } from './data'
import { IS_END, IS_START, OOS_END, searchsorted } from './engine'
import { buildExecReturns, runRegime1 } from './regime1'
import { buildEvents, metricsSeg, runListing2 } from './listing2'
import { histFinite } from './regime1'

const sql = connect()
const t0 = Date.now()
const syms = await universeSymbols(sql)
console.log(`univers : ${syms.length} symboles`)
const spot = await loadPanel(sql, syms, 'spot')
const perp = await loadPanel(sql, syms, 'futures', spot.ts)
const fund = loadFunding(fundingCsvPath(), syms, spot.ts)
const btcR = await loadBtcReturns(sql, spot.ts, 'futures')
const rExec = buildExecReturns(spot, perp)
console.log(`données chargées en ${((Date.now() - t0) / 1000).toFixed(1)} s (n=${spot.n}, na=${spot.na})`)

const EXPECT = {
  r1: { is: { sharpe: 0.89, cagr: 60.6, dd: 45.3 }, oos: { sharpe: 1.62, cagr: 103.4, dd: 34.0 } },
  l2: { meca: { sharpe: 1.31, calmar: 2.16 }, trad: { sharpe: 2.94 } },
}
const ok = (got: number, want: number, tol: number) => Math.abs(got - want) <= tol ? '✓' : `✗ (attendu ${want})`

console.log('\n=== REGIME1 (C3 perp intégral, G2,5, K7) — parité vs regime.py ===')
const inp = { spot, rExec, fund, btcR }
for (const [lab, a, b, exp] of [
  ['IS ', IS_START, IS_END, EXPECT.r1.is],
  ['OOS', IS_END, OOS_END, EXPECT.r1.oos],
] as const) {
  const lo = searchsorted(spot.ts, a)
  const hi = searchsorted(spot.ts, b)
  const m = runRegime1(inp, lo, hi)
  console.log(
    `${lab} | Sharpe ${m.sharpe.toFixed(2)} ${ok(m.sharpe, exp.sharpe, 0.02)} | ` +
    `CAGR ${m.cagr.toFixed(1)}% ${ok(m.cagr, exp.cagr, 1.5)} | DD ${m.dd.toFixed(1)}% ${ok(m.dd, exp.dd, 1.0)} | ` +
    `Calmar ${m.calmar.toFixed(2)} | ON ${(m.onShare * 100).toFixed(1)}%`,
  )
}

console.log('\n=== LISTING2 (S2 K30 stop, M=10) — parité vs strategy.py ===')
const hist = histFinite(spot)
const events = buildEvents(spot, fund, hist)
console.log(`événements : ${events.length}`)
const daily = runListing2(spot, rExec, fund, btcR, events)
const meca = metricsSeg(daily, spot.ts, '2019-02-01', '2024-01-01')
const trad = metricsSeg(daily, spot.ts, '2024-01-01', '2026-07-01')
const trades = daily.trades ?? []
const win = trades.filter((t) => t > 0).length / Math.max(trades.length, 1)
console.log(
  `mécanique 19-24 | Sharpe ${meca.sharpe.toFixed(2)} ${ok(meca.sharpe, EXPECT.l2.meca.sharpe, 0.05)} | ` +
  `Calmar ${meca.calmar.toFixed(2)} ${ok(meca.calmar, EXPECT.l2.meca.calmar, 0.10)}`,
)
console.log(
  `tradable  24-26 | Sharpe ${trad.sharpe.toFixed(2)} ${ok(trad.sharpe, EXPECT.l2.trad.sharpe, 0.08)} | ` +
  `Calmar ${trad.calmar.toFixed(2)} | trades ${trades.length}, win ${(win * 100).toFixed(0)}%`,
)

await sql.end()
