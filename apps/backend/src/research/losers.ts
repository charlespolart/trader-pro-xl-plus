/**
 * Anatomie des trades perdants de BTC Accumulator.
 * Recalcule le contexte indicateur exact à chaque vente/rachat, puis compare
 * gagnants vs perdants pour repérer un pattern évitable (mauvaise entrée ?
 * mauvaise sortie ?).
 *
 *   bun apps/backend/src/research/losers.ts
 */
import { resolve } from 'node:path'
import { ind, runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import type { Candle } from '@tpx/shared'
import accumulator from '../../../../strategies/btc-accumulator'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../data') })

const START = Date.parse('2019-01-01T00:00:00Z')
const END = Date.parse('2026-06-13T00:00:00Z')

// ---- 1) recalculer les indicateurs sur les bougies 4h et 1d
const c4 = await provider.getCandles('spot', 'BTCUSDT', '4h', START - 250 * 86_400_000, END)
const c1d = await provider.getCandles('spot', 'BTCUSDT', '1d', START - 250 * 86_400_000, END)

interface Feat4 { close: number; ema50: number; er: number; atr: number; flow: number; barsBelow: number }
const f4 = new Map<number, Feat4>()
{
  const ema = ind.ema(50).create()
  const er = ind.efficiencyRatio(20).create()
  const atr = ind.atr(14).create()
  const flow = ind.takerFlow(10).create()
  let barsBelow = 0
  for (const c of c4) {
    const e = ema.update(c)
    const erv = er.update(c)
    const av = atr.update(c)
    const fv = flow.update(c)
    if (e !== null) barsBelow = c.close < e ? barsBelow + 1 : 0
    f4.set(c.openTime, { close: c.close, ema50: e ?? NaN, er: erv ?? NaN, atr: av ?? NaN, flow: fv ?? NaN, barsBelow })
  }
}
// 1d : EMA200 + valeur 30 bougies avant (pente)
interface Feat1 { time: number; close: number; ema200: number; ema200_30ago: number }
const d1: Feat1[] = []
{
  const ema = ind.ema(200).create()
  const hist: number[] = []
  for (const c of c1d) {
    const e = ema.update(c)
    hist.push(e ?? NaN)
    d1.push({ time: c.closeTime, close: c.close, ema200: e ?? NaN, ema200_30ago: hist[hist.length - 31] ?? NaN })
  }
}
function htfAt(t: number): Feat1 | null {
  let best: Feat1 | null = null
  for (const d of d1) {
    if (d.time <= t) best = d
    else break
  }
  return best
}
function f4Before(t: number): Feat4 | null {
  // la bougie 4h clôturée juste avant l'instant t (l'entrée se décide sur close)
  let best: Feat4 | null = null
  for (const c of c4) {
    if (c.closeTime < t) best = f4.get(c.openTime) ?? best
    else break
  }
  return best
}
// max baisse atteinte entre l'entrée et la sortie (a-t-on raté le fond ?)
function maxDrop(entryT: number, exitT: number, sellPrice: number): number {
  let lowest = sellPrice
  for (const c of c4) {
    if (c.openTime >= entryT && c.openTime <= exitT) lowest = Math.min(lowest, c.low)
  }
  return ((sellPrice - lowest) / sellPrice) * 100 // % de baisse max favorable
}

// ---- 2) trades
const res = await runBacktest({
  config: {
    strategyId: 'btc-accumulator', params: {}, market: 'spot', symbol: 'BTCUSDT', start: START, end: END,
    initialBalance: 1, denomination: 'base', leverage: 1, fees: { makerRate: 0.001, takerRate: 0.001 },
    slippagePct: 0.0005, fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
    fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 1000,
  },
  def: accumulator, provider,
})
const closed = res.trades.filter((t) => t.exitTime !== null)

interface Row {
  win: boolean; pnl: number; er: number; flow: number; belowEmaPct: number; atrPct: number
  belowHtfPct: number; slopePct: number; barsBelow: number; exitType: string; barsHeld: number; maxDropPct: number
}
const rows: Row[] = []
for (const t of closed) {
  const fe = f4Before(t.entryTime)
  const he = htfAt(t.entryTime)
  if (!fe || !he) continue
  const exitType = t.fills.find((f) => f.side === 'BUY')?.tag ?? '?'
  const barsHeld = Math.round((t.exitTime! - t.entryTime) / (4 * 3_600_000))
  rows.push({
    win: t.realizedPnl > 0,
    pnl: (t.realizedPnl / t.qty) * 100,
    er: fe.er,
    flow: fe.flow,
    belowEmaPct: ((fe.ema50 - fe.close) / fe.close) * 100,        // % sous l'EMA50 à la vente
    atrPct: (fe.atr / fe.close) * 100,                            // volatilité
    belowHtfPct: ((he.ema200 - he.close) / he.close) * 100,       // % sous l'EMA200 1d (profondeur du bear)
    slopePct: ((he.ema200_30ago - he.ema200) / he.ema200) * 100,  // déclin de l'EMA200 sur 30j (force du bear)
    barsBelow: fe.barsBelow,                                      // bougies déjà sous l'EMA50 avant la vente
    exitType,
    barsHeld,
    maxDropPct: maxDrop(t.entryTime, t.exitTime!, t.avgEntryPrice),
  })
}

const wins = rows.filter((r) => r.win)
const losses = rows.filter((r) => !r.win)
const mean = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN)
const med = (arr: number[]) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)]! : NaN }

console.log(`Trades fermés: ${rows.length} | gagnants: ${wins.length} | perdants: ${losses.length}`)
console.log(`PnL moyen gagnant: +${mean(wins.map(r => r.pnl)).toFixed(2)}% | perdant: ${mean(losses.map(r => r.pnl)).toFixed(2)}%\n`)

const features: [string, (r: Row) => number][] = [
  ['ER à la vente', r => r.er],
  ['flow à la vente', r => r.flow],
  ['% sous EMA50', r => r.belowEmaPct],
  ['ATR % (volatilité)', r => r.atrPct],
  ['% sous EMA200 1d', r => r.belowHtfPct],
  ['déclin EMA200 30j %', r => r.slopePct],
  ['bougies déjà sous EMA50', r => r.barsBelow],
  ['durée (bougies)', r => r.barsHeld],
  ['baisse max atteinte %', r => r.maxDropPct],
]
console.log('feature'.padEnd(26), 'GAGNANTS (moy/méd)'.padStart(20), 'PERDANTS (moy/méd)'.padStart(20))
for (const [name, fn] of features) {
  const w = wins.map(fn).filter(Number.isFinite), l = losses.map(fn).filter(Number.isFinite)
  console.log(name.padEnd(26), `${mean(w).toFixed(2)} / ${med(w).toFixed(2)}`.padStart(20), `${mean(l).toFixed(2)} / ${med(l).toFixed(2)}`.padStart(20))
}

// corrélation de chaque feature avec le PnL (Pearson)
function corr(xs: number[], ys: number[]): number {
  const n = xs.length; const mx = mean(xs), my = mean(ys)
  let cov = 0, vx = 0, vy = 0
  for (let i = 0; i < n; i++) { cov += (xs[i]! - mx) * (ys[i]! - my); vx += (xs[i]! - mx) ** 2; vy += (ys[i]! - my) ** 2 }
  return cov / Math.sqrt(vx * vy)
}
console.log('\n— corrélation feature ↔ PnL du trade (|r|>0.2 = signal) —')
const pnls = rows.map(r => r.pnl)
for (const [name, fn] of features) {
  const xs = rows.map(fn)
  const ok = xs.map((x, i) => [x, pnls[i]!] as const).filter(([x]) => Number.isFinite(x))
  console.log(' ', name.padEnd(26), corr(ok.map(o => o[0]), ok.map(o => o[1])).toFixed(3))
}

console.log('\n— sortie : perdants par type —')
console.log('  par STOP (sl):', losses.filter(l => l.exitType === 'sl').length, '| par recroisement EMA (exit):', losses.filter(l => l.exitType === 'exit').length)
const recoverable = losses.filter(l => l.maxDropPct > 3)
console.log(`\n— perdants qui étaient POURTANT en profit à un moment (baisse max >3% avant de se retourner) : ${recoverable.length}/${losses.length}`)
console.log('  (= on avait raison sur le sens mais on a racheté trop tard / mal → sortie améliorable)')
process.exit(0)
