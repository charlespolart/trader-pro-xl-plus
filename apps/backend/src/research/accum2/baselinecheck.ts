/**
 * CONTRÔLE DE NON-RÉGRESSION des baselines produit (btc/eth-accumulator).
 * Rejoue les fenêtres canoniques de la campagne 2026-07 (données réparées,
 * coûts OKX taker 0,10% + slip 0,05%) et compare aux chiffres attendus des
 * docstrings. À lancer après tout changement moteur/données/stratégies :
 *   bun apps/backend/src/research/accum2/baselinecheck.ts
 * Sort en code 1 si un chiffre dévie — le moteur est déterministe, toute
 * dérive = régression (ou données locales altérées), à investiguer.
 */
import { resolve } from 'node:path'
import { runBacktest, type StrategyDefinition } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import btcAccum from '../../../../../strategies/btc-accumulator'
import btcVrx from '../../../../../strategies/btc-vrx'
import ethAccum from '../../../../../strategies/eth-accumulator'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../../data') })

function cfg(strategyId: string, symbol: string, start: string, end: string): BacktestConfig {
  return {
    strategyId, params: {} as ParamValues, market: 'spot', symbol,
    start: Date.parse(`${start}T00:00:00Z`), end: Date.parse(`${end}T00:00:00Z`),
    initialBalance: 1, denomination: 'base', leverage: 1,
    fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
    fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
    fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
  }
}

interface Check {
  label: string
  def: StrategyDefinition
  symbol: string
  start: string
  end: string
  /** attendu ± tolérance (tolérance = arrondi de la doc, pas du bruit moteur) */
  net: [number, number]
  dd?: [number, number]
  trades?: number
  pf?: [number, number]
}

const CHECKS: Check[] = [
  // — BTC Accumulator : baselines docstring (révision 2026-07, données complètes)
  { label: 'BTC 2019→2026', def: btcAccum, symbol: 'BTCUSDT', start: '2019-01-01', end: '2026-06-13',
    net: [61.9, 0.15], dd: [29.6, 0.15], trades: 57 },
  { label: 'BTC 2020-08→2026', def: btcAccum, symbol: 'BTCUSDT', start: '2020-08-01', end: '2026-06-09',
    net: [112.5, 0.15], dd: [28.0, 0.15], trades: 49 },
  { label: 'BTC full 2018→2026', def: btcAccum, symbol: 'BTCUSDT', start: '2018-04-05', end: '2026-07-01',
    net: [126.2, 0.15], dd: [32.5, 0.15], trades: 65 },
  { label: 'BTC 2024→2026 (chop)', def: btcAccum, symbol: 'BTCUSDT', start: '2024-01-01', end: '2026-07-01',
    net: [4.9, 0.15] },
  // — ETH Accumulator : IS + holdout (docstring ; 'both' = défaut produit)
  { label: 'ETH IS 2018→2024', def: ethAccum, symbol: 'ETHUSDT', start: '2018-04-05', end: '2024-01-01',
    net: [436, 1], trades: 38, pf: [2.65, 0.01] },
  // (le « -2% / DD -41% » des docs = confirmMode 'eth' — vérifié identique ;
  //  ici on fige le comportement des DÉFAUTS produit, 'both')
  { label: 'ETH holdout 2024→2026', def: ethAccum, symbol: 'ETHUSDT', start: '2024-01-01', end: '2026-07-01',
    net: [14.2, 0.15], dd: [23.8, 0.15], trades: 14 },
  // — BTC VRX : baselines docstring (campagne accum3 2026-07, parité python vérifiée)
  { label: 'VRX IS 2018→2024', def: btcVrx, symbol: 'BTCUSDT', start: '2018-04-05', end: '2024-01-01',
    net: [243.7, 0.15], dd: [29.1, 0.15], trades: 81 },
  { label: 'VRX OOS 2024→2026', def: btcVrx, symbol: 'BTCUSDT', start: '2024-01-01', end: '2026-07-01',
    net: [16.9, 0.15], dd: [19.7, 0.15], trades: 19 },
]

const f = (v: number, d = 1): string => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '—')
let failed = 0

for (const c of CHECKS) {
  const id = c.def === btcAccum ? 'btc-accumulator' : c.def === btcVrx ? 'btc-vrx' : 'eth-accumulator'
  const res = await runBacktest({ config: cfg(id, c.symbol, c.start, c.end), def: c.def, provider })
  const m = res.metrics
  const probs: string[] = []
  const check = (name: string, got: number, exp: number, tol: number): void => {
    if (Math.abs(got - exp) > tol) probs.push(`${name} attendu ${f(exp)} obtenu ${f(got, 2)}`)
  }
  check('net%', m.netProfitPct, c.net[0], c.net[1])
  if (c.dd) check('DD%', m.maxDrawdownPct, c.dd[0], c.dd[1])
  if (c.trades !== undefined && m.totalTrades !== c.trades) probs.push(`trades attendu ${c.trades} obtenu ${m.totalTrades}`)
  if (c.pf) check('PF', m.profitFactor ?? 0, c.pf[0], c.pf[1])
  if (res.haltedReason) probs.push(`haltedReason: ${res.haltedReason}`)

  const ok = probs.length === 0
  if (!ok) failed++
  console.log(
    `${ok ? '✓' : '✗'} ${c.label.padEnd(24)} ${f(m.netProfitPct).padStart(8)}%  DD ${f(-m.maxDrawdownPct, 1).padStart(6)}%  ${String(m.totalTrades).padStart(3)}tr  PF ${f(m.profitFactor ?? 0, 2)}` +
      (ok ? '' : `\n   ⚠ ${probs.join(' · ')}`),
  )
}

console.log(failed === 0 ? '\nBaselines intactes — rien de cassé.' : `\n${failed} fenêtre(s) HORS baseline — régression à investiguer.`)
process.exit(failed === 0 ? 0 : 1)
