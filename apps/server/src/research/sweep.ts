/**
 * Balayage de paramètres d'une famille sur une période — contrôle de plateau.
 * Un edge structurel doit avoir une MÉDIANE de grid saine, pas juste un pic.
 *
 *   bun apps/server/src/research/sweep.ts ertrend is
 */
import { resolve } from 'node:path'
import { expandGrid, runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import type { BacktestMetrics, ParamValues } from '@tpx/shared'
import { FAMILIES } from './families'
import { mkConfig, PERIODS } from './run'
import type { OptimizeSpace } from '@tpx/core'

const SPACES: Record<string, OptimizeSpace> = {
  ertrend: {
    erLen: [10, 20, 30],
    erMin: [0.25, 0.35, 0.45],
    emaLen: [30, 50, 100],
    atrMult: [2, 3],
  },
  donchian: {
    channel: [20, 30, 55, 80],
    atrMult: [1.5, 2, 3],
    tpR: [0, 3],
  },
  keltner: {
    adxMin: [15, 20, 25, 30],
    atrMult: [1.5, 2, 3],
  },
}

const famKey = process.argv[2] ?? 'ertrend'
const periodKey = process.argv[3] ?? 'is'
const fam = FAMILIES.find((f) => f.key === famKey)
if (!fam || !SPACES[famKey]) throw new Error(`famille/space inconnu: ${famKey}`)

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../data') })

const [s, e] = PERIODS[periodKey]!
const start = Date.parse(`${s}T00:00:00Z`)
const end = Date.parse(`${e}T00:00:00Z`)

import { defaultParams } from '@tpx/shared'
const base = defaultParams(fam.def.schema)
const combos = expandGrid(fam.def.schema, base, SPACES[famKey]!)
console.log(`${famKey} [${periodKey}] — ${combos.length} combinaisons`)

interface Row {
  params: ParamValues
  m: BacktestMetrics
}
const rows: Row[] = []
for (let i = 0; i < combos.length; i++) {
  const res = await runBacktest({ config: mkConfig(combos[i]!, start, end), def: fam.def, provider })
  rows.push({ params: combos[i]!, m: res.metrics })
  if ((i + 1) % 10 === 0) process.stdout.write(`${i + 1}/${combos.length} `)
}
console.log()

const sweepKeys = Object.keys(SPACES[famKey]!)
const short = (p: ParamValues): string => sweepKeys.map((k) => `${k}=${p[k]}`).join(' ')

rows.sort((a, b) => (b.m.profitFactor ?? 0) - (a.m.profitFactor ?? 0))
console.log('\n— top 8 par PF —')
for (const r of rows.slice(0, 8)) {
  console.log(
    `PF ${(r.m.profitFactor ?? 0).toFixed(2)}  net ${r.m.netProfitPct.toFixed(0)}%  dd ${r.m.maxDrawdownPct.toFixed(0)}%  tr ${r.m.totalTrades}  sharpe ${(r.m.sharpe ?? 0).toFixed(2)}   ${short(r.params)}`,
  )
}
console.log('\n— pires 4 —')
for (const r of rows.slice(-4)) {
  console.log(
    `PF ${(r.m.profitFactor ?? 0).toFixed(2)}  net ${r.m.netProfitPct.toFixed(0)}%  dd ${r.m.maxDrawdownPct.toFixed(0)}%  tr ${r.m.totalTrades}   ${short(r.params)}`,
  )
}

const pfs = rows.map((r) => r.m.profitFactor ?? 0).sort((a, b) => a - b)
const nets = rows.map((r) => r.m.netProfitPct).sort((a, b) => a - b)
const q = (xs: number[], p: number): number => xs[Math.floor(p * (xs.length - 1))]!
console.log('\n— distribution du grid (plateau ?) —')
console.log(`PF   min ${q(pfs, 0).toFixed(2)} | q25 ${q(pfs, 0.25).toFixed(2)} | médiane ${q(pfs, 0.5).toFixed(2)} | q75 ${q(pfs, 0.75).toFixed(2)} | max ${q(pfs, 1).toFixed(2)}`)
console.log(`net% min ${q(nets, 0).toFixed(0)} | q25 ${q(nets, 0.25).toFixed(0)} | médiane ${q(nets, 0.5).toFixed(0)} | q75 ${q(nets, 0.75).toFixed(0)} | max ${q(nets, 1).toFixed(0)}`)
console.log(`combos PF>1.3 : ${rows.filter((r) => (r.m.profitFactor ?? 0) > 1.3).length}/${rows.length} | PF>1 : ${rows.filter((r) => (r.m.profitFactor ?? 0) > 1).length}/${rows.length}`)
process.exit(0)
