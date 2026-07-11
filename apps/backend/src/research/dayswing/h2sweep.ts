/**
 * Phase 1 — H2 : sweep & reclaim de swing low (event study, PAS un backtest).
 *
 * Événement : le prix casse sous le dernier pivot bas CONFIRMÉ (sweep), puis
 * reclôture au-dessus en ≤ k barres (reclaim). Thèse : échec de cassure =
 * signal de force (on trade la continuation opposée, cohérent avec le fait
 * structurel « BTC continue »). Mesure : E[fwd] depuis la clôture du reclaim
 * vs baseline appariée au régime, Welch t. Miroir (sweep de swing high +
 * rejet) en contrôle : si le miroir donne la MÊME dérive positive, l'effet
 * n'est que la dérive générale → suspect.
 *
 * Sensibilité pré-enregistrée : résolution pivots L∈{3,5,8}, fenêtre reclaim
 * k∈{2,4}, grain 1h. Kill : fwd ≈ baseline régime, ou n<300, ou instable par ère.
 *
 *   bun apps/backend/src/research/dayswing/h2sweep.ts [--from=2019-01-01] [--to=2025-01-01]
 */
import { createDb } from '@tpx/db'
import { CandleStore } from '@tpx/data'
import { fractalPivots, type Pivot, type PivotState } from '@tpx/core'
import type { Candle } from '@tpx/shared'

const arg = (name: string, dflt: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? dflt
const FROM = Date.parse(arg('from', '2019-01-01') + 'T00:00:00Z')
const TO = Date.parse(arg('to', '2025-01-01') + 'T00:00:00Z')
const DAY = 86_400_000
const HOUR = 3_600_000

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN)
const sd = (v: number[]) => {
  if (v.length < 2) return NaN
  const m = mean(v)
  return Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / (v.length - 1))
}
/** Welch t entre deux échantillons */
const welch = (a: number[], b: number[]) => {
  const va = sd(a) ** 2 / a.length
  const vb = sd(b) ** 2 / b.length
  return (mean(a) - mean(b)) / Math.sqrt(va + vb)
}
const fb = (x: number, w = 7) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(1) : '—').padStart(w)
const ft = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '—').padStart(5)

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const store = new CandleStore(db)
const h1 = await store.getCandles('spot', 'BTCUSDT', '1h', FROM - 30 * DAY, TO)
const d1 = await store.getCandles('spot', 'BTCUSDT', '1d', FROM - 320 * DAY, TO)

// régime : close veille vs EMA200 veille (comme phase0)
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
const isBull = (t: number) => emaByDay.get(Math.floor(t / DAY) - 1) ?? null

// index de départ de la fenêtre d'étude
const startIdx = h1.findIndex((c) => c.openTime >= FROM)
const HORIZONS = [4, 8, 24, 48]
const logRet = (a: Candle, b: Candle) => Math.log(b.close / a.close) * 1e4

interface Ev {
  i: number // barre du reclaim (resp. rejet)
  bull: boolean | null
  depthAtr: number // profondeur du sweep sous (au-dessus) du pivot, en ATR
  flow10: number
  sweptBars: number // barres passées sous le niveau avant reclaim
}

/** détecte les events sweep&reclaim (side='low') ou sweep&reject (side='high', miroir) */
function detect(L: number, R: number, kReclaim: number, side: 'low' | 'high'): Ev[] {
  const inst = fractalPivots(L, R).create()
  // ATR14 simple pour normaliser la profondeur
  let atr = NaN
  let prevClose = NaN
  const events: Ev[] = []
  const flowWin: number[] = []
  let ref: Pivot | null = null // pivot de référence courant
  let sweepStart = -1
  let sweepExtreme = NaN
  let seen = 0
  for (let i = 0; i < h1.length; i++) {
    const c = h1[i]
    const tr = Number.isNaN(prevClose)
      ? c.high - c.low
      : Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose))
    atr = Number.isNaN(atr) ? tr : (atr * 13 + tr) / 14
    prevClose = c.close
    const f = c.volume > 0 ? c.takerBuyBase / c.volume : 0.5
    flowWin.push(f)
    if (flowWin.length > 10) flowWin.shift()
    const st = inst.update(c) as PivotState | null
    if (!st) continue
    // nouveau pivot confirmé du bon côté → nouvelle référence, reset du sweep en cours
    for (; seen < st.pivots.length; seen++) {
      const p = st.pivots[seen]
      if (p.kind === side) {
        ref = p
        sweepStart = -1
        sweepExtreme = NaN
      }
    }
    if (!ref || i < startIdx || i >= h1.length - 49) continue
    const level = ref.price
    if (side === 'low') {
      if (sweepStart < 0) {
        if (c.low < level) {
          sweepStart = i
          sweepExtreme = c.low
        }
      } else {
        sweepExtreme = Math.min(sweepExtreme, c.low)
        if (c.close > level) {
          // reclaim : clôture au-dessus du niveau balayé
          const dur = i - sweepStart + 1
          if (dur <= kReclaim) {
            events.push({
              i,
              bull: isBull(c.openTime),
              depthAtr: (level - sweepExtreme) / atr,
              flow10: mean(flowWin),
              sweptBars: dur,
            })
          }
          // niveau consommé : un seul event par pivot
          ref = null
        } else if (i - sweepStart >= 24) {
          ref = null // cassure franche, pas un sweep — invalide le niveau
        }
      }
    } else {
      if (sweepStart < 0) {
        if (c.high > level) {
          sweepStart = i
          sweepExtreme = c.high
        }
      } else {
        sweepExtreme = Math.max(sweepExtreme, c.high)
        if (c.close < level) {
          const dur = i - sweepStart + 1
          if (dur <= kReclaim) {
            events.push({
              i,
              bull: isBull(c.openTime),
              depthAtr: (sweepExtreme - level) / atr,
              flow10: mean(flowWin),
              sweptBars: dur,
            })
          }
          ref = null
        } else if (i - sweepStart >= 24) {
          ref = null
        }
      }
    }
  }
  return events
}

/** baseline appariée : E[fwd] sur TOUTES les barres du même régime */
function baseline(bull: boolean): Map<number, number> {
  const m = new Map<number, number>()
  for (const h of HORIZONS) {
    const v: number[] = []
    for (let i = startIdx; i < h1.length - 49; i++) {
      if (isBull(h1[i].openTime) !== bull) continue
      v.push(logRet(h1[i], h1[i + h]))
    }
    m.set(h, mean(v))
  }
  return m
}
const baseBull = baseline(true)
const baseBear = baseline(false)

function fwds(evs: Ev[], h: number): number[] {
  return evs.map((e) => logRet(h1[e.i], h1[e.i + h]))
}
function baseSample(bull: boolean, h: number): number[] {
  const v: number[] = []
  for (let i = startIdx; i < h1.length - 49; i++) {
    if (isBull(h1[i].openTime) !== bull) continue
    v.push(logRet(h1[i], h1[i + h]))
  }
  return v
}

console.log(`H2 sweep&reclaim — BTCUSDT 1h, ${arg('from', '2019-01-01')} → ${arg('to', '2025-01-01')}`)
console.log(`baseline bull : ${HORIZONS.map((h) => `${h}h ${fb(baseBull.get(h)!)}`).join('  ')}`)
console.log(`baseline bear : ${HORIZONS.map((h) => `${h}h ${fb(baseBear.get(h)!)}`).join('  ')}\n`)

for (const side of ['low', 'high'] as const) {
  console.log(`──── side=${side} ${side === 'low' ? '(THÈSE : reclaim → long)' : '(MIROIR/contrôle : rejet → short)'} ────`)
  console.log(
    'L/R,k'.padEnd(9) +
      'rég'.padEnd(5) +
      'n'.padStart(5) +
      HORIZONS.map((h) => `fwd${h}h vs base [tW]`.padStart(24)).join(''),
  )
  for (const L of [3, 5, 8]) {
    for (const k of [2, 4]) {
      const evs = detect(L, L, k, side)
      for (const bull of [true, false]) {
        const sel = evs.filter((e) => e.bull === bull)
        if (sel.length < 30) {
          console.log(`${L}/${L},${k}`.padEnd(9) + (bull ? 'bull' : 'bear').padEnd(5) + String(sel.length).padStart(5) + '   (trop peu)')
          continue
        }
        let row = `${L}/${L},${k}`.padEnd(9) + (bull ? 'bull' : 'bear').padEnd(5) + String(sel.length).padStart(5)
        for (const h of HORIZONS) {
          const v = fwds(sel, h)
          const base = bull ? baseSample(true, h) : baseSample(false, h)
          const t = welch(v, base)
          row += `${fb(mean(v))} vs ${fb(bull ? baseBull.get(h)! : baseBear.get(h)!, 6)} [${ft(t)}]`.padStart(24)
        }
        console.log(row)
      }
    }
  }
  console.log()
}

// stratification par profondeur de sweep et flux (config médiane 5/5, k=4, thèse long)
console.log('──── stratification (5/5, k=4, side=low, bull) ────')
const evs = detect(5, 5, 4, 'low').filter((e) => e.bull === true)
const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]
const medDepth = med(evs.map((e) => e.depthAtr))
const groups: Array<[string, (e: Ev) => boolean]> = [
  [`sweep profond (≥${medDepth.toFixed(2)} ATR)`, (e) => e.depthAtr >= medDepth],
  ['sweep superficiel', (e) => e.depthAtr < medDepth],
  ['flow10>0.5 au reclaim', (e) => e.flow10 > 0.5],
  ['flow10<0.5 au reclaim', (e) => e.flow10 < 0.5],
  ['reclaim rapide (1-2 barres)', (e) => e.sweptBars <= 2],
  ['reclaim lent (3-4 barres)', (e) => e.sweptBars > 2],
]
console.log('groupe'.padEnd(30) + 'n'.padStart(5) + HORIZONS.map((h) => `fwd${h}h [tW]`.padStart(20)).join(''))
for (const [label, pred] of groups) {
  const sel = evs.filter(pred)
  if (sel.length < 20) {
    console.log(label.padEnd(30) + String(sel.length).padStart(5) + '  (trop peu)')
    continue
  }
  let row = label.padEnd(30) + String(sel.length).padStart(5)
  for (const h of HORIZONS) {
    const v = fwds(sel, h)
    const t = welch(v, baseSample(true, h))
    row += `${fb(mean(v))} [${ft(t)}]`.padStart(20)
  }
  console.log(row)
}
process.exit(0)
