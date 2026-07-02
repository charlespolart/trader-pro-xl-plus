/**
 * STATS des patterns de chandeliers (détecteurs de production, patterns.ts)
 * en direction ACCUMULATION : les patterns BAISSIERS prédisent-ils la baisse
 * (signal de vente) ? Les HAUSSIERS prédisent-ils le rebond (timing de rachat) ?
 *
 * Étude d'événements, IS 2018-04→2024-01 (holdout intouché), 1d et 4h,
 * conditions « tous » et « bear » (close < EMA200(1d) sans lookahead),
 * stabilité par moitiés. Baseline = tous les bars du même univers.
 *   bun apps/backend/src/research/accum2/candlestats.ts
 */
import { resolve } from 'node:path'
import { candlePatterns, ALL_PATTERNS, PATTERNS } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import type { Candle } from '@tpx/shared'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../../data') })

const IS_START = Date.parse('2018-04-05T00:00:00Z')
const IS_END = Date.parse('2024-01-01T00:00:00Z')
const HALF = Date.parse('2021-02-17T00:00:00Z')
const DAY = 86_400_000

// EMA200(1d) → map closeTime→valeur pour le régime sans lookahead
const d1 = await provider.getCandles('spot', 'BTCUSDT', '1d', Date.parse('2017-08-01T00:00:00Z'), IS_END)
const e200: (number | null)[] = []
{
  let seed = 0
  let cnt = 0
  let v: number | null = null
  const a = 2 / 201
  for (const c of d1) {
    if (v === null) {
      seed += c.close
      cnt++
      if (cnt >= 200) v = seed / 200
      e200.push(v)
    } else {
      v = a * c.close + (1 - a) * v
      e200.push(v)
    }
  }
}
// bear au jour j (info close) : close[j] < ema200[j] — utilisable à partir de j+1
const bearByDay = new Map<number, boolean>()
for (let i = 0; i < d1.length; i++) {
  const day = Math.floor(d1[i]!.openTime / DAY)
  bearByDay.set(day, e200[i] !== null && d1[i]!.close < e200[i]!)
}
const isBearAt = (t: number): boolean => bearByDay.get(Math.floor(t / DAY) - 1) === true

interface Ev {
  idx: number
  t: number
}

function study(tf: '1d' | '4h', candles: Candle[], horizons: number[]): void {
  const spec = candlePatterns(undefined, {})
  const inst = spec.create()
  const fn = (c: Candle): Record<string, number> => (inst.update(c) ?? {}) as Record<string, number>
  const events = new Map<string, Ev[]>()
  for (const name of ALL_PATTERNS) events.set(name, [])
  const inIS: boolean[] = []
  candles.forEach((c, i) => {
    const out = fn(c) as Record<string, number>
    const ok = c.openTime >= IS_START && c.openTime < IS_END
    inIS.push(ok)
    if (!ok) return
    for (const name of ALL_PATTERNS) {
      if (out[name] !== 0) events.get(name)!.push({ idx: i, t: c.openTime })
    }
  })

  const maxH = Math.max(...horizons)
  const fwd = (i: number, k: number): number | null =>
    i + k < candles.length ? candles[i + k]!.close / candles[i]!.close - 1 : null

  for (const cond of ['tous', 'bear'] as const) {
    const universe: number[] = []
    for (let i = 0; i < candles.length - maxH; i++) {
      if (!inIS[i]) continue
      if (cond === 'bear' && !isBearAt(candles[i]!.openTime)) continue
      universe.push(i)
    }
    const base = new Map<number, number>()
    for (const k of horizons) {
      const xs = universe.map((i) => fwd(i, k)).filter((x): x is number => x !== null)
      base.set(k, xs.reduce((s, x) => s + x, 0) / xs.length)
    }
    console.log(`\n=== ${tf} · condition ${cond} (${universe.length} bars, baseline fwd ${horizons.map((k) => `${k}b ${(base.get(k)! * 100).toFixed(2)}%`).join(' / ')}) ===`)
    console.log('pattern'.padEnd(26) + 'dir  n   ' + horizons.map((k) => `fwd${k}b vs base`.padStart(17)).join('') + '   moitiés (h)'.padStart(16))
    for (const name of ALL_PATTERNS) {
      const dir = (PATTERNS[name] as { direction: 1 | -1 }).direction
      let evs = events.get(name)!.filter((e) => e.idx + maxH < candles.length)
      if (cond === 'bear') evs = evs.filter((e) => isBearAt(e.t))
      // dédoublonner (espacement min 3 barres)
      const ded: Ev[] = []
      let last = -10
      for (const e of evs) {
        if (e.idx - last >= 3) {
          ded.push(e)
          last = e.idx
        }
      }
      if (ded.length < 15) continue
      const parts: string[] = []
      for (const k of horizons) {
        const xs = ded.map((e) => fwd(e.idx, k)).filter((x): x is number => x !== null)
        const m = xs.reduce((s, x) => s + x, 0) / xs.length
        parts.push(`${(m * 100).toFixed(2)}% (${((m - base.get(k)!) * 100) >= 0 ? '+' : ''}${((m - base.get(k)!) * 100).toFixed(2)})`.padStart(17))
      }
      const kh = horizons[1] ?? horizons[0]!
      const h1 = ded.filter((e) => e.t < HALF).map((e) => fwd(e.idx, kh)).filter((x): x is number => x !== null)
      const h2 = ded.filter((e) => e.t >= HALF).map((e) => fwd(e.idx, kh)).filter((x): x is number => x !== null)
      const m1 = h1.length ? (h1.reduce((s, x) => s + x, 0) / h1.length) * 100 : NaN
      const m2 = h2.length ? (h2.reduce((s, x) => s + x, 0) / h2.length) * 100 : NaN
      console.log(
        name.padEnd(26) + (dir > 0 ? ' +1 ' : ' -1 ') + String(ded.length).padStart(4) + parts.join('') +
          `  ${Number.isFinite(m1) ? m1.toFixed(2) : '—'}/${Number.isFinite(m2) ? m2.toFixed(2) : '—'}`.padStart(16),
      )
    }
  }
}

console.log('événements = pattern détecté (définitions de production, requireTrend=on) ; fwd en % ; n≥15 seulement')
const c1d = await provider.getCandles('spot', 'BTCUSDT', '1d', IS_START - 30 * DAY, IS_END)
study('1d', c1d, [2, 5, 10])
const c4h = await provider.getCandles('spot', 'BTCUSDT', '4h', IS_START - 10 * DAY, IS_END)
study('4h', c4h, [6, 18, 42])
process.exit(0)
