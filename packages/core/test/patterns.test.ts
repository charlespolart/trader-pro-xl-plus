import { describe, expect, it } from 'bun:test'
import type { Candle } from '@tpx/shared'
import { bearishSignals, bullishSignals, candlePatterns, type PatternName } from '../src/indicators/patterns'

let seq = 0
function mk(o: number, h: number, l: number, c: number): Candle {
  const openTime = seq++ * 60_000
  return {
    openTime,
    open: o,
    high: h,
    low: l,
    close: c,
    volume: 100,
    quoteVolume: 100 * c,
    trades: 10,
    takerBuyBase: 50,
    takerBuyQuote: 50 * c,
    closeTime: openTime + 59_999,
  }
}

/** ~ -5 % sur 7 bougies — qualifie un downtrend (trendMinPct par défaut 0.8) */
function downtrend(): Candle[] {
  return Array.from({ length: 7 }, (_, i) => mk(110 - i, 110.2 - i, 108.8 - i, 109 - i))
}

function uptrend(): Candle[] {
  return Array.from({ length: 7 }, (_, i) => mk(100 + i, 101.2 + i, 99.8 + i, 101 + i))
}

function detect(names: PatternName[], candles: Candle[], opts = {}): Record<string, number> {
  seq = 0
  const inst = candlePatterns(names, opts).create()
  let last: Record<string, number> | null = null
  for (const c of candles) last = inst.update(c)
  return last ?? {}
}

describe('candlePatterns — 1 bougie', () => {
  it('doji / dragonfly / gravestone', () => {
    expect(detect(['doji'], [mk(100, 101, 99, 100.05)])['doji']).toBe(1)
    expect(detect(['doji'], [mk(100, 101, 99, 100.8)])['doji']).toBe(0)
    expect(detect(['dragonflyDoji'], [mk(100, 100.1, 98, 100.02)])['dragonflyDoji']).toBe(1)
    expect(detect(['gravestoneDoji'], [mk(100, 102, 99.95, 100.02)])['gravestoneDoji']).toBe(-1)
  })

  it('hammer exige un downtrend ; même forme en uptrend = hanging man', () => {
    const shape = (base: number) => mk(base - 0.5, base + 0.1, base - 2, base)
    const inDown = detect(['hammer', 'hangingMan'], [...downtrend(), shape(103)])
    expect(inDown['hammer']).toBe(1)
    expect(inDown['hangingMan']).toBe(0)

    const inUp = detect(['hammer', 'hangingMan'], [...uptrend(), shape(107)])
    expect(inUp['hammer']).toBe(0)
    expect(inUp['hangingMan']).toBe(-1)

    // sans contexte de tendance
    const raw = detect(['hammer'], [shape(100)], { requireTrend: false })
    expect(raw['hammer']).toBe(1)
  })

  it('marubozu', () => {
    expect(detect(['bullishMarubozu'], [mk(100, 105.1, 99.9, 105)])['bullishMarubozu']).toBe(1)
    expect(detect(['bearishMarubozu'], [mk(105, 105.1, 99.9, 100)])['bearishMarubozu']).toBe(-1)
    expect(detect(['bullishMarubozu'], [mk(100, 106, 99.9, 105)])['bullishMarubozu']).toBe(0) // grosse mèche haute
  })
})

describe('candlePatterns — 2 bougies', () => {
  it('bullish engulfing en downtrend uniquement', () => {
    const pair = (base: number) => [mk(base + 0.5, base + 0.6, base - 0.1, base), mk(base - 0.1, base + 0.9, base - 0.2, base + 0.8)]
    expect(detect(['bullishEngulfing'], [...downtrend(), ...pair(103)])['bullishEngulfing']).toBe(1)
    expect(detect(['bullishEngulfing'], [...uptrend(), ...pair(107)])['bullishEngulfing']).toBe(0)
  })

  it('bearish engulfing en uptrend', () => {
    const r = detect(['bearishEngulfing'], [...uptrend(), mk(107, 107.6, 106.9, 107.5), mk(107.6, 107.7, 106.6, 106.8)])
    expect(r['bearishEngulfing']).toBe(-1)
  })

  it('harami : petit corps contenu dans le grand', () => {
    const r = detect(['bullishHarami'], [...downtrend(), mk(104, 104.1, 102.4, 102.5), mk(103, 103.4, 102.8, 103.2)])
    expect(r['bullishHarami']).toBe(1)
  })

  it('tweezer bottom : lows quasi égaux', () => {
    const r = detect(['tweezerBottom'], [...downtrend(), mk(103.5, 103.6, 102.0, 102.3), mk(102.3, 103.4, 102.02, 103.2)])
    expect(r['tweezerBottom']).toBe(1)
  })

  it('rising window (gap haussier)', () => {
    const r = detect(['risingWindow'], [mk(100, 101, 99, 100.5), mk(101.5, 102.5, 101.2, 102)])
    expect(r['risingWindow']).toBe(1)
  })
})

describe('candlePatterns — 3+ bougies', () => {
  it('morning star', () => {
    const r = detect(
      ['morningStar'],
      [...downtrend(), mk(104, 104.1, 102.4, 102.5), mk(102.4, 102.6, 102.1, 102.3), mk(102.4, 103.7, 102.3, 103.6)],
    )
    expect(r['morningStar']).toBe(1)
  })

  it('three white soldiers / three black crows', () => {
    const soldiers = [mk(100, 102.2, 99.9, 102), mk(101.5, 103.7, 101.4, 103.5), mk(103, 105.2, 102.9, 105)]
    expect(detect(['threeWhiteSoldiers'], soldiers)['threeWhiteSoldiers']).toBe(1)
    const crows = [mk(105, 105.1, 102.8, 103), mk(104, 104.1, 101.3, 101.5), mk(102.5, 102.6, 99.8, 100)]
    expect(detect(['threeBlackCrows'], crows)['threeBlackCrows']).toBe(-1)
  })

  it('three outside up = engulfing + confirmation', () => {
    const r = detect(
      ['threeOutsideUp'],
      [...downtrend(), mk(103.5, 103.6, 102.9, 103), mk(102.9, 103.9, 102.8, 103.8), mk(103.8, 104.6, 103.7, 104.5)],
    )
    expect(r['threeOutsideUp']).toBe(1)
  })

  it('bullish three line strike : 3 baissières avalées par une haussière', () => {
    const r = detect(
      ['bullishThreeLineStrike'],
      [mk(105, 105.1, 103.9, 104), mk(104, 104.1, 102.9, 103), mk(103, 103.1, 101.9, 102), mk(102, 105.6, 101.8, 105.5)],
    )
    expect(r['bullishThreeLineStrike']).toBe(1)
  })
})

describe('helpers', () => {
  it('bullishSignals / bearishSignals', () => {
    expect(bullishSignals({ hammer: 1, doji: 0, hangingMan: -1 })).toEqual(['hammer'])
    expect(bearishSignals({ hammer: 1, hangingMan: -1 })).toEqual(['hangingMan'])
    expect(bullishSignals(null)).toEqual([])
  })

  it("le warmup couvre le pattern le plus long + la tendance", () => {
    const spec = candlePatterns(['bullishThreeLineStrike'])
    expect(spec.warmup).toBeGreaterThanOrEqual(4 + 5)
  })
})
