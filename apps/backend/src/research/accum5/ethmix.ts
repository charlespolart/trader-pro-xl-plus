/**
 * eth-accumulator DANS UN PORTEFEUILLE BTC-MAX : sa poche est en ETH — pour la
 * juger à côté de v2+VRX il faut la convertir en BTC (équité ETH × ETHBTC).
 * Sorties : eth-acc en ETH (sa dénomination), en BTC (ce que voit un
 * portefeuille BTC-max), corrélations, et mix 3 voies vs duo.
 *   bun apps/backend/src/research/accum5/ethmix.ts
 */
import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
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

async function ethbtcCloses(): Promise<Map<number, number>> {
  const rows = (await db.execute(
    `SELECT open_time, close FROM candles WHERE market='spot' AND symbol='ETHBTC' AND interval='4h' ORDER BY open_time`,
  )) as unknown as Array<{ open_time: string | number; close: number }>
  const m = new Map<number, number>()
  for (const r of rows) m.set(Number(r.open_time), Number(r.close))
  return m
}

function stats(eq: number[]): { net: number; dd: number } {
  let peak = -Infinity
  let dd = 0
  for (const v of eq) {
    peak = Math.max(peak, v)
    dd = Math.min(dd, (v - peak) / peak)
  }
  return { net: (eq[eq.length - 1]! / eq[0]! - 1) * 100, dd: dd * 100 }
}

function corr(a: number[], b: number[]): number {
  const ra: number[] = []
  const rb: number[] = []
  for (let i = 1; i < a.length; i++) {
    const x = Math.log(a[i]! / a[i - 1]!)
    const y = Math.log(b[i]! / b[i - 1]!)
    if (x !== 0 || y !== 0) {
      ra.push(x)
      rb.push(y)
    }
  }
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(xs.length, 1)
  const ma = mean(ra)
  const mb = mean(rb)
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < ra.length; i++) {
    sxy += (ra[i]! - ma) * (rb[i]! - mb)
    sxx += (ra[i]! - ma) ** 2
    syy += (rb[i]! - mb) ** 2
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0
}

const f = (v: number): string => (v >= 0 ? '+' : '') + v.toFixed(1)
const eb = await ethbtcCloses()

for (const [label, start, end] of [
  ['IS  2018-04→2024-01', '2018-04-05', '2024-01-01'],
  ['OOS 2024-01→2026-07', '2024-01-01', '2026-07-01'],
] as const) {
  const a = await runBacktest({ config: cfg('btc-accumulator', 'BTCUSDT', start, end), def: btcAccum, provider })
  const b = await runBacktest({ config: cfg('btc-vrx', 'BTCUSDT', start, end), def: btcVrx, provider })
  const e = await runBacktest({ config: cfg('eth-accumulator', 'ETHUSDT', start, end), def: ethAccum, provider })
  const ea = new Map(a.equity.map((p) => [p.time, p.equity]))
  const evb = new Map(b.equity.map((p) => [p.time, p.equity]))
  const ee = new Map(e.equity.map((p) => [p.time, p.equity]))
  const H4 = 14_400_000
  const ratioAt = (t: number): number | undefined =>
    eb.get(Math.floor(t / H4) * H4) ?? eb.get(Math.floor(t / H4) * H4 - H4) ?? eb.get(Math.floor(t / H4) * H4 - 2 * H4)
  const times = [...ea.keys()].filter((t) => evb.has(t) && ee.has(t) && ratioAt(t) !== undefined).sort((x, y) => x - y)
  const v2 = times.map((t) => ea.get(t)!)
  const vrx = times.map((t) => evb.get(t)!)
  const ethE = times.map((t) => ee.get(t)!)                       // en ETH
  const r0 = ratioAt(times[0]!)!
  const ethB = times.map((t, i) => (ethE[i]! * ratioAt(t)!) / (ethE[0]! * r0)) // en BTC, normalisé
  const ratio = times.map((t) => ratioAt(t)! / r0)                // buy&hold ETH en BTC
  const nv2 = v2.map((v) => v / v2[0]!)
  const nvx = vrx.map((v) => v / vrx[0]!)
  const duo = times.map((_, i) => 0.5 * nv2[i]! + 0.5 * nvx[i]!)
  const trio = times.map((_, i) => (nv2[i]! + nvx[i]! + ethB[i]!) / 3)
  const sE = stats(ethE.map((v) => v / ethE[0]!))
  const sB = stats(ethB)
  const sR = stats(ratio)
  const sDuo = stats(duo)
  const sTrio = stats(trio)
  console.log(`${label}`)
  console.log(`  eth-acc en ETH    ${f(sE.net).padStart(7)}%  DD ${f(sE.dd)}%   (sa dénomination — le job qu'elle fait bien)`)
  console.log(`  ETH buy&hold en BTC ${f(sR.net).padStart(6)}%  DD ${f(sR.dd)}%   (le beta ETHBTC subi par toute poche ETH)`)
  console.log(`  eth-acc en BTC    ${f(sB.net).padStart(7)}%  DD ${f(sB.dd)}%   (ce que voit un portefeuille BTC-max)`)
  console.log(`  duo v2+VRX        ${f(sDuo.net).padStart(7)}%  DD ${f(sDuo.dd)}%`)
  console.log(`  trio (+ poche ETH)${f(sTrio.net).padStart(7)}%  DD ${f(sTrio.dd)}%`)
  console.log(`  corr(eth-acc_BTC, v2) ${corr(ethB, nv2).toFixed(2)}  corr(eth-acc_BTC, vrx) ${corr(ethB, nvx).toFixed(2)}`)
}
process.exit(0)
