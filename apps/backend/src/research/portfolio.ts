/**
 * Portefeuille 50/50 BTC+ETH sur er-flow-trend (params candidats, figés) :
 * combine les courbes d'équité et mesure la réduction de variance.
 * Période complète 2020-08 → 2026-06 (IS+OOS confondus — c'est une analyse
 * de DIVERSIFICATION, pas une sélection de paramètres).
 */
import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import type { EquityPoint } from '@tpx/shared'
import erFlow from './accum2/legacy/er-flow-trend'
import { mkConfig } from './run'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../data') })

const START = Date.parse('2020-08-01T00:00:00Z')
const END = Date.parse('2026-06-09T00:00:00Z')
const PARAMS = { erLen: 20, erMin: 0.35, emaLen: 50, atrMult: 2.5, useFlowFilter: true }

function stats(eq: { time: number; equity: number }[]): { net: number; maxDd: number; sharpe: number } {
  let peak = -Infinity
  let maxDd = 0
  const rets: number[] = []
  for (let i = 0; i < eq.length; i++) {
    const v = eq[i]!.equity
    peak = Math.max(peak, v)
    maxDd = Math.max(maxDd, peak > 0 ? ((peak - v) / peak) * 100 : 0)
    if (i > 0 && eq[i - 1]!.equity > 0) rets.push(v / eq[i - 1]!.equity - 1)
  }
  const mu = rets.reduce((a, b) => a + b, 0) / rets.length
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mu) ** 2, 0) / (rets.length - 1))
  const periodsPerYear = (365.25 * 24) / 4 // équité échantillonnée en 4h
  return {
    net: (eq[eq.length - 1]!.equity / eq[0]!.equity - 1) * 100,
    maxDd,
    sharpe: sd > 0 ? (mu / sd) * Math.sqrt(periodsPerYear) : 0,
  }
}

console.log('run BTC…')
const btcCfg = { ...mkConfig(PARAMS, START, END), symbol: 'BTCUSDT' }
const btc = await runBacktest({ config: btcCfg, def: erFlow, provider })
console.log('run ETH…')
const ethCfg = { ...mkConfig(PARAMS, START, END), symbol: 'ETHUSDT' }
const eth = await runBacktest({ config: ethCfg, def: erFlow, provider })

// combinaison 50/50 (capital séparé, pas de rééquilibrage) sur l'union des timestamps
function normalize(eq: EquityPoint[]): Map<number, number> {
  const base = eq[0]!.equity
  return new Map(eq.map((pt) => [pt.time, pt.equity / base]))
}
const a = normalize(btc.equity)
const b = normalize(eth.equity)
const times = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => x - y)
let lastA = 1
let lastB = 1
const combined: { time: number; equity: number }[] = []
for (const t of times) {
  lastA = a.get(t) ?? lastA
  lastB = b.get(t) ?? lastB
  combined.push({ time: t, equity: (lastA + lastB) / 2 })
}

const sBtc = stats(btc.equity.map((pt) => ({ time: pt.time, equity: pt.equity })))
const sEth = stats(eth.equity.map((pt) => ({ time: pt.time, equity: pt.equity })))
const sMix = stats(combined)

const row = (label: string, s: { net: number; maxDd: number; sharpe: number }, trades?: number): void => {
  console.log(
    `${label.padEnd(16)} net ${s.net.toFixed(1).padStart(7)}%  maxDD ${s.maxDd.toFixed(1).padStart(5)}%  sharpe ${s.sharpe.toFixed(2).padStart(5)}${trades !== undefined ? `  trades ${trades}` : ''}`,
  )
}
console.log()
row('BTC seul', sBtc, btc.metrics.totalTrades)
row('ETH seul', sEth, eth.metrics.totalTrades)
row('Portefeuille 50/50', sMix, btc.metrics.totalTrades + eth.metrics.totalTrades)
console.log(`\nratio net/DD : BTC ${(sBtc.net / sBtc.maxDd).toFixed(2)} | ETH ${(sEth.net / sEth.maxDd).toFixed(2)} | 50/50 ${(sMix.net / sMix.maxDd).toFixed(2)}`)
process.exit(0)
