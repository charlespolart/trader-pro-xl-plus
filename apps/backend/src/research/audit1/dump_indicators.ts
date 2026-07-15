/**
 * audit1/A1 — dump des 27 indicateurs de @tpx/core sur BTCUSDT 4h réel,
 * pour cross-check contre des implémentations Python indépendantes.
 *   DATABASE_URL=postgres://tpx:tpx@localhost:5438/tpx bun apps/backend/src/research/audit1/dump_indicators.ts
 * Sortie : audit1/out/indicators_btc4h.json (bougies + séries calculées)
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fractalPivots, ind } from '@tpx/core'
import { CandleStore } from '@tpx/data'
import { createDb } from '@tpx/db'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5438/tpx')
const store = new CandleStore(db)

const START = Date.parse('2022-01-01T00:00:00Z')
const END = Date.parse('2024-01-01T00:00:00Z')
const candles = await store.getCandles('spot', 'BTCUSDT', '4h', START, END)
console.log(`${candles.length} bougies 4h`)

// (nom, spec, extracteur multi-sorties éventuel)
const specs: Array<[string, { create(): { update(c: (typeof candles)[number]): unknown } }, string[] | null]> = [
  ['sma20', ind.sma(20), null],
  ['ema21', ind.ema(21), null],
  ['wma14', ind.wma(14), null],
  ['hma16', ind.hma(16), null],
  ['vwap_day', ind.vwap('day'), null],
  ['rvwap20', ind.rollingVwap(20), null],
  ['rsi14', ind.rsi(14), null],
  ['macd', ind.macd(12, 26, 9), ['macd', 'signal', 'hist']],
  ['stoch', ind.stoch(14, 3, 3), ['k', 'd']],
  ['stochrsi', ind.stochRsi(14, 14, 3, 3), ['k', 'd']],
  ['cci20', ind.cci(20), null],
  ['mfi14', ind.mfi(14), null],
  ['obv', ind.obv(), null],
  ['roc10', ind.roc(10), null],
  ['willr14', ind.willr(14), null],
  ['atr14', ind.atr(14), null],
  ['bb', ind.bbands(20, 2), ['upper', 'middle', 'lower']],
  ['kc', ind.keltner(20, 2, 10), ['upper', 'middle', 'lower']],
  ['donch20', ind.donchian(20), ['upper', 'middle', 'lower']],
  ['adx14', ind.adx(14), ['adx', 'plusDi', 'minusDi']],
  ['supertrend', ind.supertrend(10, 3), ['value', 'direction']],
  ['psar', ind.psar(0.02, 0.02, 0.2), null],
  ['takerflow20', ind.takerFlow(20), null],
  ['er10', ind.efficiencyRatio(10), null],
  ['atrpct', ind.atrPercentile(14, 100), null],
  ['squeeze', ind.squeezeRatio(20, 2, 1.5, 10), null],
  ['vr', ind.varianceRatio(5, 60), null],
]

const out: Record<string, (number | null)[]> = {}
for (const [name, spec, outputs] of specs) {
  const inst = spec.create()
  if (outputs) {
    for (const o of outputs) out[`${name}.${o}`] = []
  } else {
    out[name] = []
  }
  for (const c of candles) {
    const v = inst.update(c) as Record<string, number> | number | null
    if (outputs) {
      for (const o of outputs) {
        out[`${name}.${o}`]!.push(v === null ? null : ((v as Record<string, number>)[o] ?? null))
      }
    } else {
      out[name as string]!.push(v as number | null)
    }
  }
}

// pivots (structure) : liste (barIndex, kind, price, confirmedAtIndex)
{
  const inst = fractalPivots(5, 5).create()
  let last: { pivots: unknown[] } | null = null
  for (const c of candles) {
    const v = inst.update(c) as { pivots: unknown[] } | null
    if (v) last = v
  }
  out['__pivots'] = [] // marqueur
  ;(out as Record<string, unknown>)['pivots_5_5'] = (last?.pivots ?? []).map((p) => {
    const q = p as { barIndex: number; kind: string; price: number; confirmedAtIndex: number }
    return [q.barIndex, q.kind === 'high' ? 1 : 0, q.price, q.confirmedAtIndex]
  })
}

const dir = resolve(import.meta.dir, 'out')
mkdirSync(dir, { recursive: true })
writeFileSync(
  resolve(dir, 'indicators_btc4h.json'),
  JSON.stringify({
    candles: candles.map((c) => [c.openTime, c.open, c.high, c.low, c.close, c.volume, c.takerBuyBase]),
    series: out,
  }),
)
console.log(`écrit: audit1/out/indicators_btc4h.json (${Object.keys(out).length} séries)`)
process.exit(0)
