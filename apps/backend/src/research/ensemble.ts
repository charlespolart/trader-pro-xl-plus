/** Ensemble 50/50 sur BTC : er-flow-trend + keltner-squeeze — complémentaires ? */
import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import erFlow from './accum2/legacy/er-flow-trend'
import { FAMILIES } from './families'
import { mkConfig } from './run'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../data') })
const START = Date.parse('2020-08-01T00:00:00Z')
const END = Date.parse('2026-06-09T00:00:00Z')

function stats(eq: { time: number; equity: number }[]) {
  let peak = -Infinity, maxDd = 0
  const rets: number[] = []
  for (let i = 0; i < eq.length; i++) {
    const v = eq[i]!.equity
    peak = Math.max(peak, v)
    maxDd = Math.max(maxDd, peak > 0 ? ((peak - v) / peak) * 100 : 0)
    if (i > 0 && eq[i - 1]!.equity > 0) rets.push(v / eq[i - 1]!.equity - 1)
  }
  const mu = rets.reduce((a, b) => a + b, 0) / rets.length
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mu) ** 2, 0) / (rets.length - 1))
  return { net: (eq[eq.length - 1]!.equity / eq[0]!.equity - 1) * 100, maxDd, sharpe: sd > 0 ? (mu / sd) * Math.sqrt((365.25 * 24) / 4) : 0, rets }
}

const a = await runBacktest({ config: mkConfig({ erLen: 20, erMin: 0.35, emaLen: 50, atrMult: 2.5, useFlowFilter: true }, START, END), def: erFlow, provider })
const kc = FAMILIES.find((f) => f.key === 'keltner')!
const b = await runBacktest({ config: mkConfig({ adxMin: 25, useSqueeze: true }, START, END), def: kc.def, provider })

const norm = (eq: typeof a.equity) => new Map(eq.map((p) => [p.time, p.equity / eq[0]!.equity]))
const mA = norm(a.equity), mB = norm(b.equity)
const times = [...new Set([...mA.keys(), ...mB.keys()])].sort((x, y) => x - y)
let lA = 1, lB = 1
const mix = times.map((t) => { lA = mA.get(t) ?? lA; lB = mB.get(t) ?? lB; return { time: t, equity: (lA + lB) / 2 } })

const sA = stats(a.equity), sB = stats(b.equity), sM = stats(mix)
// corrélation des rendements 4h
const n = Math.min(sA.rets.length, sB.rets.length)
const ra = sA.rets.slice(0, n), rb = sB.rets.slice(0, n)
const ma = ra.reduce((x, y) => x + y, 0) / n, mb = rb.reduce((x, y) => x + y, 0) / n
let cov = 0, va = 0, vb = 0
for (let i = 0; i < n; i++) { cov += (ra[i]! - ma) * (rb[i]! - mb); va += (ra[i]! - ma) ** 2; vb += (rb[i]! - mb) ** 2 }
const corr = cov / Math.sqrt(va * vb)

const row = (l: string, s: { net: number; maxDd: number; sharpe: number }) =>
  console.log(`${l.padEnd(22)} net ${s.net.toFixed(1).padStart(7)}%  maxDD ${s.maxDd.toFixed(1).padStart(5)}%  sharpe ${s.sharpe.toFixed(2).padStart(5)}  net/DD ${(s.net / s.maxDd).toFixed(2)}`)
console.log()
row('er-flow', sA)
row('keltner-squeeze', sB)
row('ensemble 50/50', sM)
console.log(`\ncorrélation des rendements 4h : ${corr.toFixed(3)}`)
process.exit(0)
