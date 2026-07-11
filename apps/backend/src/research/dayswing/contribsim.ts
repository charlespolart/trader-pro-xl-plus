/**
 * Comparatif à contributions mensuelles (demande utilisateur, 2026-07-11) :
 * 500 €/mois versés soit en DCA (achat immédiat, jamais revendu), soit comme
 * budget de trading pour BTC Swing (défauts donchian ; le cash s'accumule et
 * n'est engagé que sur signal). Simulation 4 h aux règles exactes de la
 * stratégie, coûts 15 bps/côté. 4 dates de départ → docs/btc-swing-vs-dca.html
 * (injection des séries dans le template scratchpad).
 *   bun apps/backend/src/research/dayswing/contribsim.ts <template> <out>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { createDb } from '@tpx/db'
import { CandleStore, PgDataProvider } from '@tpx/data'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import accum from '../../../../../strategies/btc-accumulator'

const [, , TPL, OUT] = process.argv
const DAY = 86_400_000
const SIDE = 0.0015
const MONTHLY = 500
const END = Date.now() // jusqu'à aujourd'hui — la base est topée par accum2/data.ts

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const store = new CandleStore(db)
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../data') })

/** index BTC de l'accumulateur (equity base-denom, départ 1 BTC) sur [start, END) — moteur réel */
async function accumIndex(startMs: number): Promise<(ms: number) => number> {
  const cfg: BacktestConfig = {
    strategyId: 'btc-accumulator', params: {} as ParamValues, market: 'spot', symbol: 'BTCUSDT',
    start: startMs, end: END, initialBalance: 1, denomination: 'base', leverage: 1,
    fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
    fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
    fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
  }
  const res = await runBacktest({ config: cfg, def: accum, provider })
  const pts = res.equity
  const times = pts.map((p) => p.time)
  return (ms: number) => {
    // dernier point ≤ ms (recherche binaire)
    let lo = 0
    let hi = times.length - 1
    if (ms < times[0]) return 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (times[mid] <= ms) lo = mid
      else hi = mid - 1
    }
    return pts[lo].equity
  }
}
const h4 = await store.getCandles('spot', 'BTCUSDT', '4h', Date.parse('2018-01-01T00:00:00Z'), END)
const d1 = await store.getCandles('spot', 'BTCUSDT', '1d', Date.parse('2017-08-01T00:00:00Z'), END)
const n = h4.length
const close = h4.map((c) => c.close)
const high = h4.map((c) => c.high)
const low = h4.map((c) => c.low)
const open = h4.map((c) => c.open)
const vol = h4.map((c) => c.volume)

// régime : close 1d de la veille vs EMA200 1d
const emaByDay = new Map<number, boolean>()
{
  const k = 2 / 201
  let ema = NaN
  const seed: number[] = []
  for (const c of d1) {
    if (Number.isNaN(ema)) {
      seed.push(c.close)
      if (seed.length === 200) ema = seed.reduce((a, b) => a + b, 0) / 200
    } else ema = c.close * k + ema * (1 - k)
    if (!Number.isNaN(ema)) emaByDay.set(Math.floor(c.openTime / DAY), c.close > ema)
  }
}
const bullAt = (i: number) => emaByDay.get(Math.floor(h4[i].openTime / DAY) - 1) === true

// indicateurs 4 h (mêmes défauts que la stratégie)
const ema50 = (() => {
  const out = new Array<number>(n).fill(NaN)
  const k = 2 / 51
  let e = NaN
  let s = 0
  for (let i = 0; i < n; i++) {
    if (i < 50) {
      s += close[i]
      if (i === 49) { e = s / 50; out[i] = e }
    } else { e = close[i] * k + e * (1 - k); out[i] = e }
  }
  return out
})()
const atr14 = (() => {
  const out = new Array<number>(n).fill(NaN)
  let a = NaN
  for (let i = 0; i < n; i++) {
    const tr = i === 0 ? high[i] - low[i] : Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]))
    a = Number.isNaN(a) ? tr : (a * 13 + tr) / 14
    out[i] = a
  }
  return out
})()
const don55prev = (() => {
  const out = new Array<number>(n).fill(NaN)
  const dq: number[] = []
  for (let i = 0; i < n; i++) {
    if (i >= 1) {
      while (dq.length && high[dq[dq.length - 1]] <= high[i - 1]) dq.pop()
      dq.push(i - 1)
      while (dq.length && dq[0] < i - 55) dq.shift()
      if (i >= 55) out[i] = high[dq[0]]
    }
  }
  return out
})()
const volSma20 = (() => {
  const out = new Array<number>(n).fill(NaN)
  let s = 0
  for (let i = 0; i < n; i++) {
    s += vol[i]
    if (i >= 20) s -= vol[i - 20]
    if (i >= 19) out[i] = s / 20
  }
  return out
})()
const sig = (i: number) => close[i] > don55prev[i] && vol[i] > 1.5 * volSma20[i] && bullAt(i)
const monthKey = (ms: number) => { const d = new Date(ms); return d.getUTCFullYear() * 12 + d.getUTCMonth() }

function maxDD(eq: number[]): number {
  let peak = -Infinity
  let dd = 0
  for (const v of eq) { peak = Math.max(peak, v); dd = Math.min(dd, v / peak - 1) }
  return dd * 100
}

interface Scen { kick: string; label: string; sub: string; start: string }
const SCENARIOS: Scen[] = [
  { kick: 'Situation 1', label: 'Depuis janvier 2019 — le cycle complet', sub: '7 ans et demi : deux bulls, deux bears, le chop ETF. 500 €/mois du début à juillet 2026.', start: '2019-01-01' },
  { kick: 'Situation 2', label: 'Depuis janvier 2021 — commencer près du sommet', sub: 'Le pire timing psychologique : un an de bull euphorique, puis le bear 2022 en pleine phase d’accumulation.', start: '2021-01-01' },
  { kick: 'Situation 3', label: 'Depuis janvier 2022 — commencer en plein bear', sub: 'Le test du sang-froid : le DCA achète toute la descente ; la stratégie attend en USDT.', start: '2022-01-01' },
  { kick: 'Situation 4', label: 'Depuis janvier 2024 — l’ère ETF', sub: 'Chop haussier puis retournement 2025-2026 : le régime le plus dur pour tout le monde.', start: '2024-01-01' },
]

const out: unknown[] = []
for (const sc of SCENARIOS) {
  const startMs = Date.parse(`${sc.start}T00:00:00Z`)
  const i0 = h4.findIndex((c) => c.openTime >= startMs)

  // ---- stratégie : cash accumulé + trades aux règles produit
  let cash = 0
  let qty = 0
  let stop = 0
  let pendingSpend = 0 // signal pris à i, exécuté à l'open i+1
  let lastMonth = -1
  let trades = 0
  let months = 0
  const eqS: number[] = []
  for (let i = i0; i < n; i++) {
    const mk = monthKey(h4[i].openTime)
    if (mk !== lastMonth) { cash += MONTHLY; months++; lastMonth = mk }
    if (pendingSpend > 0) {
      const px = open[i] * (1 + SIDE)
      qty = pendingSpend / px
      cash -= pendingSpend
      trades++
      pendingSpend = 0
    }
    if (qty > 0) {
      if (low[i] <= stop) { cash += qty * stop * (1 - SIDE); qty = 0 }
      else if (close[i] < ema50[i]) { cash += qty * close[i] * (1 - SIDE); qty = 0 }
    } else if (pendingSpend === 0 && sig(i) && i < n - 1) {
      pendingSpend = 0.98 * cash
      stop = Math.max(close[i] - 2.5 * atr14[i], close[i] * 0.96)
    }
    eqS.push(cash + qty * close[i])
  }

  // ---- DCA : achat de 500 € au 1er bar 4h de chaque mois, jamais revendu
  // ---- DCA→ACCUMULATEUR : mêmes versements, le stack est géré par la stratégie de prod
  //      (index BTC du moteur appliqué à chaque versement depuis sa date : U += btc_versé/idx(t_d),
  //       valeur = U × idx(t) × prix — exact pour une stratégie 100 % BTC ou 100 % USDT)
  const idx = await accumIndex(startMs)
  let btc = 0
  let uAcc = 0
  let lastM2 = -1
  const eqD: number[] = []
  const eqA: number[] = []
  const paid: number[] = []
  let cum = 0
  for (let i = i0; i < n; i++) {
    const ms = h4[i].openTime
    const mk = monthKey(ms)
    if (mk !== lastM2) {
      const b = (MONTHLY * (1 - SIDE)) / open[i]
      btc += b
      uAcc += b / idx(ms)
      cum += MONTHLY
      lastM2 = mk
    }
    eqD.push(btc * close[i])
    eqA.push(uAcc * idx(ms) * close[i])
    paid.push(cum)
  }

  // ---- échantillonnage (1 point / 2 jours = 1 bar 4h sur 12) + stats plein grain
  const t: number[] = []
  const s: number[] = []
  const d: number[] = []
  const a: number[] = []
  const p: number[] = []
  for (let j = 0; j < eqS.length; j++) {
    if (j % 12 === 0 || j === eqS.length - 1) {
      t.push(h4[i0 + j].openTime)
      s.push(Math.round(eqS[j]))
      d.push(Math.round(eqD[j]))
      a.push(Math.round(eqA[j]))
      p.push(paid[j])
    }
  }
  const dcaPeak = Math.max(...eqD)
  const stratPeak = Math.max(...eqS)
  const accPeak = Math.max(...eqA)
  out.push({
    kick: sc.kick, label: sc.label, sub: sc.sub, t, strat: s, dca: d, acc: a, paid: p,
    stats: {
      paid: cum, months, trades,
      stratFinal: Math.round(eqS[eqS.length - 1]), dcaFinal: Math.round(eqD[eqD.length - 1]),
      accFinal: Math.round(eqA[eqA.length - 1]),
      stratDD: maxDD(eqS), dcaDD: maxDD(eqD), accDD: maxDD(eqA),
      // où on en est AUJOURD'HUI par rapport au plus-haut du compte
      stratFromPeak: (eqS[eqS.length - 1] / stratPeak - 1) * 100,
      dcaFromPeak: (eqD[eqD.length - 1] / dcaPeak - 1) * 100,
      accFromPeak: (eqA[eqA.length - 1] / accPeak - 1) * 100,
    },
  })
  const st = (out[out.length - 1] as { stats: Record<string, number> }).stats
  console.log(
    `${sc.start}  versé ${st.paid}€ · DCA ${st.dcaFinal}€ (×${(st.dcaFinal / st.paid).toFixed(2)}, DD ${st.dcaDD.toFixed(0)}%)` +
      ` · DCA→ACCUM ${st.accFinal}€ (×${(st.accFinal / st.paid).toFixed(2)}, DD ${st.accDD.toFixed(0)}%, auj. ${st.accFromPeak.toFixed(0)}% du pic)` +
      ` · SWING ${st.stratFinal}€ (×${(st.stratFinal / st.paid).toFixed(2)}, DD ${st.stratDD.toFixed(0)}%)`,
  )
}

if (TPL && OUT) {
  const html = readFileSync(TPL, 'utf-8').replace('/*__DATA__*/null', JSON.stringify(out))
  writeFileSync(OUT, html)
  console.log(`\nécrit → ${OUT} (${(html.length / 1024).toFixed(0)} Ko)`)
}
process.exit(0)
