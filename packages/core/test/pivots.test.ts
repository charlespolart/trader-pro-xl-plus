import { describe, expect, it } from 'bun:test'
import type { Candle } from '@tpx/shared'
import { fractalPivots, zigzag, type PivotState, type ZigzagState } from '../src/indicators/pivots'

/** bougie synthétique : close=price, high/low = price ± wick */
function bar(i: number, price: number, wick = 0): Candle {
  return {
    openTime: i * 3_600_000,
    open: price,
    high: price + wick,
    low: price - wick,
    close: price,
    volume: 100,
    quoteVolume: 100 * price,
    trades: 10,
    takerBuyBase: 50,
    takerBuyQuote: 50 * price,
    closeTime: (i + 1) * 3_600_000 - 1,
  }
}
const series = (prices: number[], wick = 0) => prices.map((p, i) => bar(i, p, wick))

/** marche aléatoire déterministe (LCG) — même convention que reference.test.ts */
function randomWalk(n: number, seed = 42): Candle[] {
  let s = seed >>> 0
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
  const out: Candle[] = []
  let price = 100
  for (let i = 0; i < n; i++) {
    const drift = (rand() - 0.5) * 4
    const open = price
    const close = Math.max(1, price + drift)
    const high = Math.max(open, close) + rand() * 2
    const low = Math.min(open, close) - rand() * 2
    out.push({
      openTime: i * 3_600_000,
      open,
      high,
      low,
      close,
      volume: 100 + rand() * 50,
      quoteVolume: 0,
      trades: 10,
      takerBuyBase: 50,
      takerBuyQuote: 0,
      closeTime: (i + 1) * 3_600_000 - 1,
    })
    price = close
  }
  return out
}

function runAll<O>(spec: { create(): { update(c: Candle): O | null } }, candles: Candle[]): (O | null)[] {
  const inst = spec.create()
  return candles.map((c) => inst.update(c))
}

describe('fractalPivots', () => {
  it('detects a hand-built swing high and low with exact confirmation lag', () => {
    // ⚠ l'état est muté en place : on snapshotte PENDANT l'itération (contrat de
    // l'indicateur : ne lire que l'état courant), jamais via des refs conservées.
    //                       0  1  2  3  4  5  6  7  8  9  10
    const candles = series([10, 11, 12, 13, 12, 11, 10, 9, 10, 11, 12])
    // L=2/R=2 : pivot haut à i=3 (13) confirmé à i=5 ; pivot bas à i=7 (9) confirmé à i=9
    const inst = fractalPivots(2, 2).create()
    const counts: number[] = []
    const snaps: Array<{ kind: string; barIndex: number; price: number; confirmedAtIndex: number } | null> = []
    let sawNullThroughBar3 = true
    candles.forEach((c, i) => {
      const s = inst.update(c) as PivotState | null
      if (i <= 3 && s !== null) sawNullThroughBar3 = false
      counts.push(s ? s.pivots.length : -1)
      const last = s && s.pivots.length ? s.pivots[s.pivots.length - 1] : null
      snaps.push(last ? { kind: last.kind, barIndex: last.barIndex, price: last.price, confirmedAtIndex: last.confirmedAtIndex } : null)
    })
    expect(sawNullThroughBar3).toBe(true) // warmup : 5 barres nécessaires
    expect(counts[4]).toBe(0)
    expect(counts[5]).toBe(1)
    expect(snaps[5]).toEqual({ kind: 'high', barIndex: 3, price: 13, confirmedAtIndex: 5 })
    expect(counts[8]).toBe(1) // le bas n'est PAS encore connu à i=8
    expect(counts[9]).toBe(2)
    expect(snaps[9]).toEqual({ kind: 'low', barIndex: 7, price: 9, confirmedAtIndex: 9 })
  })

  it('confirmation lag is exactly `right` bars for every pivot', () => {
    const out = runAll(fractalPivots(3, 4), randomWalk(400)) as (PivotState | null)[]
    const final = out[out.length - 1]!
    expect(final.pivots.length).toBeGreaterThan(10)
    for (const p of final.pivots) {
      expect(p.confirmedAtIndex - p.barIndex).toBe(4)
      expect(p.confirmedAtTime - p.openTime).toBe(4 * 3_600_000)
    }
  })

  it('plateau of equal highs yields exactly one pivot: the FIRST bar of the plateau', () => {
    //                       0  1  2   3   4   5  6  7
    const candles = series([10, 11, 12, 13, 13, 12, 11, 10])
    const out = runAll(fractalPivots(2, 2), candles) as (PivotState | null)[]
    const final = out[out.length - 1]!
    const highs = final.pivots.filter((p) => p.kind === 'high')
    expect(highs).toHaveLength(1)
    expect(highs[0].barIndex).toBe(3) // première barre du plateau, pas la seconde
  })

  it('NO LOOKAHEAD: state at bar k is invariant to truncation of the future', () => {
    const candles = randomWalk(300, 7)
    const spec = fractalPivots(4, 4)
    // run complet : snapshot du nombre de pivots confirmés après chaque barre
    const inst = spec.create()
    const fullCounts: number[] = []
    const fullLast: (string | null)[] = []
    for (const c of candles) {
      const s = inst.update(c)
      fullCounts.push(s ? s.pivots.length : 0)
      fullLast.push(s && s.pivots.length ? `${s.pivots[s.pivots.length - 1].kind}@${s.pivots[s.pivots.length - 1].barIndex}` : null)
    }
    // pour CHAQUE préfixe : une instance fraîche doit produire exactement le même état
    for (let k = 1; k <= candles.length; k++) {
      const fresh = spec.create()
      let s: PivotState | null = null
      for (let i = 0; i < k; i++) s = fresh.update(candles[i])
      const count = s ? s.pivots.length : 0
      const last = s && s.pivots.length ? `${s.pivots[s.pivots.length - 1].kind}@${s.pivots[s.pivots.length - 1].barIndex}` : null
      expect(count).toBe(fullCounts[k - 1])
      expect(last).toBe(fullLast[k - 1])
    }
  })

  it('never confirms a pivot before its lag has elapsed (causality on a trap series)', () => {
    // monte jusqu'à 13 à i=3 puis repart au-dessus après la confirmation : le pivot
    // 13 est un vrai max LOCAL (confirmé i=5) même si le futur le dépasse. On vérifie
    // surtout qu'à i=4 rien n'est encore publié (pas de confirmation anticipée).
    const candles = series([10, 11, 12, 13, 12, 12.5, 14, 15, 16, 17, 18])
    const inst = fractalPivots(2, 2).create()
    const counts: number[] = []
    let final: PivotState | null = null
    for (const c of candles) {
      final = inst.update(c) as PivotState | null
      counts.push(final ? final.pivots.length : -1)
    }
    expect(counts[4]).toBe(0) // pas publié avant le lag
    expect(counts[5]).toBe(1) // publié pile à la confirmation
    expect(final!.pivots.filter((p) => p.kind === 'high')).toHaveLength(1)
    expect(final!.pivots[0].confirmedAtIndex).toBe(5)
  })
})

describe('zigzag', () => {
  it('absorbs small swings below the ATR threshold and alternates high/low', () => {
    // grande jambe up, micro-dip (< seuil), nouvelle jambe up, vrai renversement
    const prices = [
      100, 102, 104, 106, 108, 110, // up
      109.5, 109, 109.5, // micro-dip (à absorber)
      111, 113, 115, 117, // up again
      114, 110, 106, 102, 98, // vrai renversement
      100, 102, 104, 106, 108,
    ]
    const out = runAll(zigzag(2, 2, 1.5, 5), series(prices, 0.3)) as (ZigzagState | null)[]
    const final = out[out.length - 1]!
    // alternance stricte
    for (let i = 1; i < final.points.length; i++) {
      expect(final.points[i].kind).not.toBe(final.points[i - 1].kind)
    }
    // le micro-dip à ~109 ne doit PAS être un point ; le haut de jambe doit être 117
    const highs = final.points.filter((p) => p.kind === 'high')
    expect(highs.some((p) => p.price >= 117)).toBe(true)
    const lows = final.points.filter((p) => p.kind === 'low')
    expect(lows.every((p) => p.price < 109 || p.price > 111)).toBe(true)
  })

  it('same-kind stronger pivot REPLACES the last point (leg extension), causally', () => {
    const candles = randomWalk(500, 13)
    const out = runAll(zigzag(3, 3, 1.0, 14), candles) as (ZigzagState | null)[]
    const final = out[out.length - 1]!
    expect(final.points.length).toBeGreaterThan(4)
    for (let i = 1; i < final.points.length; i++) {
      expect(final.points[i].kind).not.toBe(final.points[i - 1].kind)
      // chronologie des points (les barIndex montent)
      expect(final.points[i].barIndex).toBeGreaterThan(final.points[i - 1].barIndex)
    }
    // structure HH/HL lisible : chaque point sauf le premier a une amplitude ≥ seuil
    for (let i = 1; i < final.points.length - 1; i++) {
      expect(final.points[i].legAtrMult).toBeGreaterThanOrEqual(1.0)
    }
  })

  it('NO LOOKAHEAD: truncation invariance of the accepted-points sequence (excluding the mutable last)', () => {
    const candles = randomWalk(300, 99)
    const spec = zigzag(3, 3, 1.2, 10)
    const inst = spec.create()
    const fullSnaps: string[] = []
    for (const c of candles) {
      const s = inst.update(c)
      // le DERNIER point est remplaçable par contrat ; tous les précédents sont figés
      fullSnaps.push(s ? s.points.slice(0, -1).map((p) => `${p.kind}@${p.barIndex}`).join('|') : '')
    }
    for (let k = 50; k <= candles.length; k += 23) {
      const fresh = spec.create()
      let s: ZigzagState | null = null
      for (let i = 0; i < k; i++) s = fresh.update(candles[i])
      const snap = s ? s.points.slice(0, -1).map((p) => `${p.kind}@${p.barIndex}`).join('|') : ''
      expect(snap).toBe(fullSnaps[k - 1])
    }
  })
})
