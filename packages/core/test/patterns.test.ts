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

  it('three line strike — nommage Bulkowski (par la tendance des 3 premières bougies)', () => {
    // bearish 3LS : trois noires descendantes avalées par une grande blanche
    const bearish = detect(
      ['bearishThreeLineStrike'],
      [mk(105, 105.1, 103.9, 104), mk(104, 104.1, 102.9, 103), mk(103, 103.1, 101.9, 102), mk(102, 105.6, 101.8, 105.5)],
      { requireTrend: false },
    )
    expect(bearish['bearishThreeLineStrike']).toBe(-1)
    // bullish 3LS : trois blanches montantes avalées par une grande noire
    const bullish = detect(
      ['bullishThreeLineStrike'],
      [mk(100, 102.2, 99.9, 102), mk(102, 104.2, 101.9, 104), mk(104, 106.2, 103.9, 106), mk(106, 106.4, 99.2, 99.5)],
      { requireTrend: false },
    )
    expect(bullish['bullishThreeLineStrike']).toBe(1)
  })

  it('strictGaps : piercing line canonique ouvre sous le plus bas précédent', () => {
    const a = mk(104, 104.1, 102.4, 102.5) // grande noire, low 102.4
    const noGap = mk(102.5, 103.6, 102.3, 103.5) // ouvre à la clôture (crypto 24/7)
    expect(detect(['piercingLine'], [...downtrend(), a, noGap])['piercingLine']).toBe(1)
    expect(detect(['piercingLine'], [...downtrend(), a, noGap], { strictGaps: true })['piercingLine']).toBe(0)
    const gap = mk(102.2, 103.6, 102.1, 103.5) // ouvre sous 102.4
    expect(detect(['piercingLine'], [...downtrend(), a, gap], { strictGaps: true })['piercingLine']).toBe(1)
  })

  it("strictGaps : morning star canonique exige le gap du corps de l'étoile", () => {
    const a = mk(104, 104.1, 102.4, 102.5)
    const star = mk(102.2, 102.45, 102.0, 102.1) // corps entièrement sous le corps de a
    const c3 = mk(102.5, 103.8, 102.4, 103.7) // ouvre au-dessus du corps de l'étoile
    expect(detect(['morningStar'], [...downtrend(), a, star, c3], { strictGaps: true })['morningStar']).toBe(1)
    const starHigh = mk(102.5, 102.9, 102.4, 102.6) // pas de gap de corps
    expect(detect(['morningStar'], [...downtrend(), a, starHigh, c3], { strictGaps: true })['morningStar']).toBe(0)
  })
})

describe('régressions — formes qui ne doivent PAS matcher', () => {
  it("gros corps avec petites mèches des deux côtés ≠ famille marteau (bug report capture d'écran)", () => {
    // ressemble à la bougie du screenshot : corps 57% du range, mèches 30%/13%
    const big = mk(100, 101.05, 93.5, 94)
    const r = detect(['hammer', 'invertedHammer', 'hangingMan', 'shootingStar'], [big], { requireTrend: false })
    expect(r['hammer']).toBe(0)
    expect(r['invertedHammer']).toBe(0)
    expect(r['hangingMan']).toBe(0)
    expect(r['shootingStar']).toBe(0)
  })

  it('marteau inversé avec une mèche basse visible (> 8% du range) → rejeté', () => {
    // longue mèche haute OK mais mèche basse à ~13% du range : « il y a un trait en dessous »
    const c = mk(100, 104, 99.4, 100.2)
    expect(detect(['invertedHammer'], [c], { requireTrend: false })['invertedHammer']).toBe(0)
    // la même sans mèche basse (et corps non-doji) passe
    const clean = mk(100, 104, 99.95, 100.6)
    expect(detect(['invertedHammer'], [clean], { requireTrend: false })['invertedHammer']).toBe(1)
  })

  it('mèche dominante trop courte (< 55% du range) → pas un marteau', () => {
    const c = mk(100, 100.4, 98.9, 100.1) // lower ≈ 0.53R… limite basse
    const r = detect(['hammer'], [c], { requireTrend: false, dominantShadowMin: 0.6 })
    expect(r['hammer']).toBe(0)
  })

  it('three white soldiers avec longues mèches hautes (clôtures loin des hauts) → rejeté', () => {
    const wicky = [mk(100, 103.5, 99.9, 102), mk(101.5, 105.2, 101.4, 103.5), mk(103, 107, 102.9, 105)]
    expect(detect(['threeWhiteSoldiers'], wicky)['threeWhiteSoldiers']).toBe(0)
  })

  it("morning star dont l'étoile flotte au-dessus du milieu de la 1re bougie → rejeté", () => {
    const r = detect(
      ['morningStar'],
      [...downtrend(), mk(104, 104.1, 102.4, 102.5), mk(103.6, 103.9, 103.4, 103.75), mk(103.7, 104.2, 103.5, 104.1)],
    )
    expect(r['morningStar']).toBe(0)
  })

  it('kicker : les deux bougies doivent être fortes', () => {
    // première bougie faiblarde (corps < 60% du range)
    const r = detect(['bullishKicker'], [mk(100, 100.6, 98.9, 99.9), mk(100.5, 102.6, 100.45, 102.5)])
    expect(r['bullishKicker']).toBe(0)
    const ok = detect(['bullishKicker'], [mk(100, 100.05, 98.9, 99), mk(100.5, 102.6, 100.45, 102.5)])
    expect(ok['bullishKicker']).toBe(1)
  })
})

describe('couleur du corps — famille marteau', () => {
  // mèche basse 71% du range, mèche haute ~0, corps en haut
  const redHammer = (base: number) => mk(base, base + 0.05, base - 2, base - 0.5) // bear
  const greenHammer = (base: number) => mk(base - 0.5, base + 0.05, base - 2, base) // bull

  it('défaut (canonique Nison/StockCharts) : la couleur ne compte pas', () => {
    expect(detect(['hammer'], [...downtrend(), redHammer(103)])['hammer']).toBe(1)
    expect(detect(['hammer'], [...downtrend(), greenHammer(103)])['hammer']).toBe(1)
  })

  it('strictColor (style wikiHow) : hammer vert uniquement, hanging man rouge uniquement', () => {
    expect(detect(['hammer'], [...downtrend(), redHammer(103)], { strictColor: true })['hammer']).toBe(0)
    expect(detect(['hammer'], [...downtrend(), greenHammer(103)], { strictColor: true })['hammer']).toBe(1)
    // hanging man : même forme en uptrend — doit être ROUGE en strict
    expect(detect(['hangingMan'], [...uptrend(), greenHammer(108)], { strictColor: true })['hangingMan']).toBe(0)
    expect(detect(['hangingMan'], [...uptrend(), redHammer(108)], { strictColor: true })['hangingMan']).toBe(-1)
  })
})

describe('helpers', () => {
  it('bullishSignals / bearishSignals', () => {
    expect(bullishSignals({ hammer: 1, doji: 0, hangingMan: -1 })).toEqual(['hammer'])
    expect(bearishSignals({ hammer: 1, hangingMan: -1 })).toEqual(['hangingMan'])
    expect(bullishSignals(null)).toEqual([])
  })

  it("le warmup couvre le pattern le plus long + la tendance", () => {
    const spec = candlePatterns(['bearishThreeLineStrike'])
    expect(spec.warmup).toBeGreaterThanOrEqual(4 + 5)
  })
})
