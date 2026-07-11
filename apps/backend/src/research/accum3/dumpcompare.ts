/**
 * Données pour docs/btc-acc-vs-vrx.html : équités moteur réelles v2 / VRX / mix
 * 50-50 sur 2018-04→2026-07, sous-échantillonnées au jour, + drawdowns, nets
 * annuels et métriques par stratégie. Sort un JSON dans le scratchpad.
 *   bun apps/backend/src/research/accum3/dumpcompare.ts
 */
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import btcAccum from '../../../../../strategies/btc-accumulator'
import btcVrx from '../../../../../strategies/btc-vrx'

const OUT = '/private/tmp/claude-501/-Users-charlespolart-Documents-Coding-trader-pro-xl-plus/54291f66-b329-40d9-943e-8410c7d8a340/scratchpad/compare.json'
const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../../data') })

function cfg(strategyId: string, start: string, end: string): BacktestConfig {
  return {
    strategyId, params: {} as ParamValues, market: 'spot', symbol: 'BTCUSDT',
    start: Date.parse(`${start}T00:00:00Z`), end: Date.parse(`${end}T00:00:00Z`),
    initialBalance: 1, denomination: 'base', leverage: 1,
    fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
    fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
    fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
  }
}

const START = '2018-04-05'
const END = '2026-07-01'
const a = await runBacktest({ config: cfg('btc-accumulator', START, END), def: btcAccum, provider })
const b = await runBacktest({ config: cfg('btc-vrx', START, END), def: btcVrx, provider })

const ea = new Map(a.equity.map((p) => [p.time, p.equity]))
const eb = new Map(b.equity.map((p) => [p.time, p.equity]))
const times = [...ea.keys()].filter((t) => eb.has(t)).sort((x, y) => x - y)
const va = times.map((t) => ea.get(t)!)
const vb = times.map((t) => eb.get(t)!)
const v0a = va[0]!
const v0b = vb[0]!
const mix = times.map((_, i) => 0.5 * (va[i]! / v0a) + 0.5 * (vb[i]! / v0b))
const nva = va.map((v) => v / v0a)
const nvb = vb.map((v) => v / v0b)

function dd(xs: number[]): number[] {
  let peak = -Infinity
  return xs.map((v) => {
    peak = Math.max(peak, v)
    return ((v - peak) / peak) * 100
  })
}
const dda = dd(nva)
const ddb = dd(nvb)
const ddm = dd(mix)

// sous-échantillonnage quotidien (6 barres de 4h), dernier point conservé
const step = 6
const idx: number[] = []
for (let i = 0; i < times.length; i += step) idx.push(i)
if (idx[idx.length - 1] !== times.length - 1) idx.push(times.length - 1)

// nets annuels
function yearly(xs: number[]): Record<string, number> {
  const out: Record<string, number> = {}
  let y0 = new Date(times[0]!).getUTCFullYear()
  let startV = xs[0]!
  for (let i = 1; i < times.length; i++) {
    const y = new Date(times[i]!).getUTCFullYear()
    if (y !== y0) {
      out[String(y0)] = (xs[i - 1]! / startV - 1) * 100
      y0 = y
      startV = xs[i - 1]!
    }
  }
  out[String(y0)] = (xs[xs.length - 1]! / startV - 1) * 100
  return out
}

const payload = {
  start: START, end: END,
  t: idx.map((i) => times[i]),
  v2: idx.map((i) => +nva[i]!.toFixed(4)),
  vrx: idx.map((i) => +nvb[i]!.toFixed(4)),
  mix: idx.map((i) => +mix[i]!.toFixed(4)),
  dd_v2: idx.map((i) => +dda[i]!.toFixed(2)),
  dd_vrx: idx.map((i) => +ddb[i]!.toFixed(2)),
  dd_mix: idx.map((i) => +ddm[i]!.toFixed(2)),
  yearly: { v2: yearly(nva), vrx: yearly(nvb), mix: yearly(mix) },
  metrics: {
    v2: { net: a.metrics.netProfitPct, dd: a.metrics.maxDrawdownPct, trades: a.metrics.totalTrades,
          wr: a.metrics.winRate ?? null, pf: a.metrics.profitFactor ?? null },
    vrx: { net: b.metrics.netProfitPct, dd: b.metrics.maxDrawdownPct, trades: b.metrics.totalTrades,
           wr: b.metrics.winRate ?? null, pf: b.metrics.profitFactor ?? null },
    mix: { net: (mix[mix.length - 1]! - 1) * 100, dd: Math.min(...ddm) },
  },
}
writeFileSync(OUT, JSON.stringify(payload))
console.log(`→ ${OUT} (${idx.length} points)`)
console.log(JSON.stringify(payload.metrics, null, 1))
console.log('yearly v2 ', payload.yearly.v2)
console.log('yearly vrx', payload.yearly.vrx)
process.exit(0)
