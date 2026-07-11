/**
 * Phase 3 — validation de strategies/btc-swing.ts (défauts figés post-D15).
 * ⚠ Span 2019-01→2026-01 : le holdout 2026-01→07 n'est JAMAIS touché ici.
 *
 * Sections :
 *  1. Walk-forward 6 fenêtres roulantes (walkForwardWindows, isRatio 0,6) :
 *     défauts FIGÉS sur chaque OOS (le chiffre qui compte = OOS composé) +
 *     variante RE-OPTIMISÉE (grille plateau 27 combos, garde minTrades) pour
 *     vérifier que le re-fit n'est pas nécessaire (leçon accum : il peut nuire).
 *  2. Null timing-aveugle apparié sur le composé OOS : mêmes nombre/durées de
 *     trades par fenêtre OOS, entrées tirées dans les barres 4h BULL-gatées de
 *     la même fenêtre, 200 tirages → percentile du réel (barre : ≥ 95).
 *  3. Stress : coûts ×2/×3, intrabarPath pessimistic, equityPct 60 (DD).
 *  4. Transfert ETH (mêmes défauts, signe attendu cohérent).
 *
 *   bun apps/backend/src/research/dayswing/wfswing.ts [--windows=6] [--skip-reopt]
 */
import { resolve } from 'node:path'
import { runBacktest, walkForwardWindows } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import swing from '../../../../../strategies/btc-swing'

const arg = (name: string, dflt: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? dflt
const WINDOWS = Number(arg('windows', '6'))
const SKIP_REOPT = process.argv.includes('--skip-reopt')
// --entry=donchian|union : passe entryMode à la stratégie (vague 2, D21) ; défaut = comportement historique
const ENTRY = arg('entry', 'ema')
const BASE_PARAMS: ParamValues = (ENTRY === 'ema' ? {} : { entryMode: ENTRY }) as ParamValues
const START = Date.parse('2019-01-01T00:00:00Z')
const END = Date.parse('2026-01-01T00:00:00Z')
const DAY = 86_400_000

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../data') })

function cfg(start: number, end: number, params: ParamValues, over: Partial<BacktestConfig> = {}): BacktestConfig {
  return {
    strategyId: 'btc-swing', params, market: 'spot', symbol: 'BTCUSDT',
    start, end, initialBalance: 10_000, denomination: 'quote', leverage: 1,
    fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
    fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
    fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
    ...over,
  }
}
const fmt = (v: number, d = 1): string => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '—')
const dstr = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

interface TradeLite { entryTime: number; exitTime: number }
async function bt(start: number, end: number, params: ParamValues, over: Partial<BacktestConfig> = {}) {
  const res = await runBacktest({ config: cfg(start, end, params, over), def: swing, provider })
  const trades: TradeLite[] = (res.trades ?? [])
    .filter((t) => t.exitTime != null)
    .map((t) => ({ entryTime: t.entryTime, exitTime: t.exitTime! }))
  return { m: res.metrics, trades }
}

// ---------- 1. walk-forward ----------
console.log(`Phase 3 — BTC Swing [entry=${ENTRY}], WF ${WINDOWS} fenêtres 2019-01→2026-01 (holdout 2026-01→07 intact)\n`)
const windows = walkForwardWindows(START, END, { windows: WINDOWS, isRatio: 0.6, anchored: false })

const GRID: ParamValues[] = []
for (const erMin of [0.3, 0.35, 0.4])
  for (const emaLen of [40, 50, 60])
    for (const atrMult of [2, 2.5, 3]) GRID.push({ erMin, emaLen, atrMult } as unknown as ParamValues)
const MIN_TRADES_REOPT = 6

let frozenCompound = 1
let reoptCompound = 1
let frozenPos = 0
let reoptPos = 0
const oosTradesFrozen: Array<{ trades: TradeLite[]; start: number; end: number; net: number }> = []

console.log('fenêtre'.padEnd(26) + 'FIGÉ net%'.padStart(11) + '  tr' + '  RE-OPT net%'.padStart(14) + '  tr' + '   params choisis (IS)')
for (const w of windows) {
  const frozen = await bt(w.oosStart, w.oosEnd, BASE_PARAMS)
  frozenCompound *= 1 + frozen.m.netProfitPct / 100
  if (frozen.m.netProfitPct > 0) frozenPos++
  oosTradesFrozen.push({ trades: frozen.trades, start: w.oosStart, end: w.oosEnd, net: frozen.m.netProfitPct })

  let reLabel = '—'
  let reNet = NaN
  if (!SKIP_REOPT) {
    let best: { params: ParamValues; score: number } | null = null
    for (const g of GRID) {
      const r = await bt(w.isStart, w.isEnd, { ...BASE_PARAMS, ...g } as ParamValues)
      if (r.m.totalTrades < MIN_TRADES_REOPT) continue
      if (!best || r.m.netProfitPct > best.score) best = { params: g, score: r.m.netProfitPct }
    }
    const chosen = { ...BASE_PARAMS, ...(best?.params ?? {}) } as ParamValues
    const re = await bt(w.oosStart, w.oosEnd, chosen)
    reNet = re.m.netProfitPct
    reoptCompound *= 1 + reNet / 100
    if (reNet > 0) reoptPos++
    reLabel = best ? `er${(chosen as Record<string, number>).erMin} ema${(chosen as Record<string, number>).emaLen} atr${(chosen as Record<string, number>).atrMult}` : 'défauts (IS < minTrades)'
  }
  console.log(
    `${dstr(w.oosStart)}→${dstr(w.oosEnd)}`.padEnd(26) + fmt(frozen.m.netProfitPct).padStart(11) +
      String(frozen.m.totalTrades).padStart(4) + fmt(reNet).padStart(14) + '    ' + reLabel,
  )
}
console.log(`\nOOS composé FIGÉ : ${fmt((frozenCompound - 1) * 100)}% (${frozenPos}/${WINDOWS} fenêtres +)` +
  (SKIP_REOPT ? '' : ` · RE-OPT : ${fmt((reoptCompound - 1) * 100)}% (${reoptPos}/${WINDOWS} +)`))

// ---------- 2. null timing-aveugle apparié ----------
console.log('\n══ Null timing-aveugle (200 tirages, entrées dans les barres bull de chaque fenêtre OOS) ══')
{
  const h4 = await provider.getCandles('spot', 'BTCUSDT', '4h', START - 250 * DAY, END)
  const d1 = await provider.getCandles('spot', 'BTCUSDT', '1d', START - 320 * DAY, END)
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length
  const emaByDay = new Map<number, boolean>()
  {
    const k = 2 / 201
    let ema = NaN
    const seed: number[] = []
    for (const c of d1) {
      if (Number.isNaN(ema)) {
        seed.push(c.close)
        if (seed.length === 200) ema = mean(seed)
      } else ema = c.close * k + ema * (1 - k)
      if (!Number.isNaN(ema)) emaByDay.set(Math.floor(c.openTime / DAY), c.close > ema)
    }
  }
  const bullBars: number[] = [] // index dans h4
  for (let i = 0; i < h4.length; i++) {
    if (h4[i].openTime < START || h4[i].openTime >= END) continue
    if (emaByDay.get(Math.floor(h4[i].openTime / DAY) - 1) === true) bullBars.push(i)
  }
  const idxByTime = new Map<number, number>()
  h4.forEach((c, i) => idxByTime.set(c.openTime, i))

  let s = 0xd45e11
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
  const nulls: number[] = []
  for (let draw = 0; draw < 200; draw++) {
    let compound = 1
    for (const w of oosTradesFrozen) {
      let wRet = 1
      const wBull = bullBars.filter((i) => h4[i].openTime >= w.start && h4[i].openTime < w.end)
      for (const t of w.trades) {
        const durBars = Math.max(1, Math.round((t.exitTime - t.entryTime) / (4 * 3_600_000)))
        if (!wBull.length) continue
        const at = wBull[Math.floor(rand() * wBull.length)]
        const end = Math.min(at + durBars, h4.length - 1)
        // coûts défauts : taker aller-retour + slip = 30 bps
        wRet *= (h4[end].close / h4[at].close) * (1 - 0.003)
      }
      compound *= wRet
    }
    nulls.push((compound - 1) * 100)
  }
  nulls.sort((a, b) => a - b)
  const real = (frozenCompound - 1) * 100
  const below = nulls.filter((x) => x < real).length
  const q = (p: number) => nulls[Math.min(nulls.length - 1, Math.floor(p * nulls.length))]
  console.log(`réel ${fmt(real)}% · null méd ${fmt(q(0.5))}% · p95 ${fmt(q(0.95))}% · percentile du réel = ${((below / nulls.length) * 100).toFixed(1)} (barre ≥ 95)`)
}

// ---------- 3. stress ----------
console.log('\n══ Stress (IS+OOS 2019→2026-01, défauts figés) ══')
{
  const base = await bt(START, END, BASE_PARAMS)
  console.log(`base                 net ${fmt(base.m.netProfitPct).padStart(8)}%  PF ${(base.m.profitFactor ?? NaN).toFixed(2)}  DD ${fmt(base.m.maxDrawdownPct)}%  tr ${base.m.totalTrades}`)
  const x2 = await bt(START, END, BASE_PARAMS, { fees: { makerRate: 0.0016, takerRate: 0.002 }, slippagePct: 0.001 })
  console.log(`coûts ×2             net ${fmt(x2.m.netProfitPct).padStart(8)}%  PF ${(x2.m.profitFactor ?? NaN).toFixed(2)}  DD ${fmt(x2.m.maxDrawdownPct)}%`)
  const x3 = await bt(START, END, BASE_PARAMS, { fees: { makerRate: 0.0024, takerRate: 0.003 }, slippagePct: 0.0015 })
  console.log(`coûts ×3             net ${fmt(x3.m.netProfitPct).padStart(8)}%  PF ${(x3.m.profitFactor ?? NaN).toFixed(2)}  DD ${fmt(x3.m.maxDrawdownPct)}%`)
  const pess = await bt(START, END, BASE_PARAMS, { intrabarPath: 'pessimistic' })
  console.log(`intrabar pessimiste  net ${fmt(pess.m.netProfitPct).padStart(8)}%  PF ${(pess.m.profitFactor ?? NaN).toFixed(2)}  DD ${fmt(pess.m.maxDrawdownPct)}%`)
  const eq60 = await bt(START, END, { ...BASE_PARAMS, equityPct: 60 } as unknown as ParamValues)
  console.log(`equityPct 60 (DD)    net ${fmt(eq60.m.netProfitPct).padStart(8)}%  PF ${(eq60.m.profitFactor ?? NaN).toFixed(2)}  DD ${fmt(eq60.m.maxDrawdownPct)}%`)
}

// ---------- 4. transfert ETH ----------
console.log('\n══ Transfert ETH (défauts, spot ETHUSDT) ══')
{
  const res = await runBacktest({
    config: { ...cfg(START, END, BASE_PARAMS), symbol: 'ETHUSDT' },
    def: swing,
    provider,
  })
  const m = res.metrics
  console.log(`ETH 2019→2026-01     net ${fmt(m.netProfitPct).padStart(8)}%  PF ${(m.profitFactor ?? NaN).toFixed(2)}  WR ${m.winRate.toFixed(0)}%  DD ${fmt(m.maxDrawdownPct)}%  tr ${m.totalTrades}`)
}
process.exit(0)
