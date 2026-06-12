import type { Candle } from '@tpx/shared'
import { defineIndicator, type IndicatorSpec } from './types'

/**
 * Détection de patterns de chandeliers japonais, sous forme d'indicateur
 * incrémental standard : branchez `candlePatterns([...])` avec ctx.indicator()
 * et lisez `value.hammer` etc. (+1 détection haussière, -1 baissière, 0 rien).
 *
 * Tous les seuils sont RELATIFS (corps/mèches en fraction du range de la
 * bougie, tendance en % de variation) et configurables via PatternOptions.
 *
 * Le contexte de tendance fait partie de la définition classique des patterns
 * de retournement (un hammer sans tendance baissière préalable n'est pas un
 * hammer — la même bougie en tendance haussière est un hanging man). Mettez
 * requireTrend: false pour détecter les formes brutes sans contexte.
 *
 * Non couvert ici (phase 2, moteur de pivots requis) : double top/bottom,
 * cup & handle, wedge, flag. Les windows (gaps) sont implémentées mais quasi
 * inexistantes en crypto (marché 24/7).
 */

export interface PatternOptions {
  /** corps ≤ x·range ⇒ doji (défaut 0.1) */
  dojiBodyMax: number
  /** mèche dominante ≥ x·corps pour hammer & co (défaut 2) */
  shadowBodyRatio: number
  /** mèche dominante ≥ x·range pour hammer & co (défaut 0.55) */
  dominantShadowMin: number
  /** mèche OPPOSÉE ≤ x·range pour hammer & co — « peu ou pas de mèche » (défaut 0.08) */
  oppositeShadowMax: number
  /** mèche « courte » ≤ x·range (soldiers/crows : clôtures près des extrêmes) (défaut 0.25) */
  shortShadowMax: number
  /** mèches ≤ x·range ⇒ marubozu (défaut 0.05) */
  marubozuShadowMax: number
  /** corps ≤ x·range ⇒ spinning top / étoile (défaut 0.35) */
  smallBodyMax: number
  /** corps ≥ x·range ⇒ bougie « forte » (défaut 0.6) */
  strongBodyMin: number
  /** tolérance d'égalité de prix, fraction du prix (tweezers…) (défaut 0.0015) */
  nearTolerance: number
  /** bougies utilisées pour qualifier la tendance précédant le pattern (défaut 5) */
  trendLookback: number
  /** variation nette minimale (%) pour qualifier une tendance (défaut 0.8) */
  trendMinPct: number
  /** exiger le contexte de tendance des définitions classiques (défaut true) */
  requireTrend: boolean
}

export const DEFAULT_PATTERN_OPTIONS: PatternOptions = {
  dojiBodyMax: 0.1,
  shadowBodyRatio: 2,
  dominantShadowMin: 0.55,
  oppositeShadowMax: 0.08,
  shortShadowMax: 0.25,
  marubozuShadowMax: 0.05,
  smallBodyMax: 0.35,
  strongBodyMin: 0.6,
  nearTolerance: 0.0015,
  trendLookback: 5,
  trendMinPct: 0.8,
  requireTrend: true,
}

// ----------------------------------------------------------------- helpers

const body = (c: Candle): number => Math.abs(c.close - c.open)
const range = (c: Candle): number => Math.max(c.high - c.low, 1e-12)
const upperShadow = (c: Candle): number => c.high - Math.max(c.open, c.close)
const lowerShadow = (c: Candle): number => Math.min(c.open, c.close) - c.low
const bull = (c: Candle): boolean => c.close > c.open
const bear = (c: Candle): boolean => c.close < c.open
const bodyTop = (c: Candle): number => Math.max(c.open, c.close)
const bodyBottom = (c: Candle): number => Math.min(c.open, c.close)
const bodyMid = (c: Candle): number => (c.open + c.close) / 2
const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= Math.max(a, b) * tol

const isDojiC = (c: Candle, o: PatternOptions): boolean => body(c) <= o.dojiBodyMax * range(c)
const smallBody = (c: Candle, o: PatternOptions): boolean => body(c) <= o.smallBodyMax * range(c)
const strongBody = (c: Candle, o: PatternOptions): boolean => body(c) >= o.strongBodyMin * range(c)

/**
 * Forme marteau (canonique, Nison) : longue mèche basse (≥ ratio×corps ET
 * ≥ dominantShadowMin×range), corps dans le haut, mèche haute quasi absente.
 */
const hammerShape = (c: Candle, o: PatternOptions): boolean =>
  lowerShadow(c) >= o.shadowBodyRatio * Math.max(body(c), range(c) * 0.03) &&
  lowerShadow(c) >= o.dominantShadowMin * range(c) &&
  upperShadow(c) <= o.oppositeShadowMax * range(c) &&
  !isDojiC(c, o)

/** forme marteau inversé : longue mèche haute, corps en bas, mèche basse quasi absente */
const invHammerShape = (c: Candle, o: PatternOptions): boolean =>
  upperShadow(c) >= o.shadowBodyRatio * Math.max(body(c), range(c) * 0.03) &&
  upperShadow(c) >= o.dominantShadowMin * range(c) &&
  lowerShadow(c) <= o.oppositeShadowMax * range(c) &&
  !isDojiC(c, o)

const engulfsBody = (big: Candle, small: Candle): boolean =>
  bodyTop(big) >= bodyTop(small) && bodyBottom(big) <= bodyBottom(small) && body(big) > body(small)

const insideBody = (inner: Candle, outer: Candle): boolean =>
  bodyTop(inner) <= bodyTop(outer) && bodyBottom(inner) >= bodyBottom(outer)

// --------------------------------------------------------------- detectors

interface Detector {
  /** nombre de bougies du pattern */
  lookback: number
  /** +1 signal haussier, -1 baissier (doji & spinning tops : indécision, signe indicatif) */
  direction: 1 | -1
  /** contexte classique requis (ignoré si requireTrend: false) */
  needsTrend: 'up' | 'down' | null
  /** w contient exactement `lookback` bougies, la dernière = bougie courante */
  detect(w: Candle[], o: PatternOptions): boolean
}

export const PATTERNS = {
  // ---- 1 bougie
  doji: {
    lookback: 1,
    direction: 1,
    needsTrend: null,
    detect: ([c], o) => isDojiC(c!, o),
  },
  dragonflyDoji: {
    lookback: 1,
    direction: 1,
    needsTrend: null,
    detect: ([c], o) => isDojiC(c!, o) && lowerShadow(c!) >= 0.6 * range(c!) && upperShadow(c!) <= 0.1 * range(c!),
  },
  gravestoneDoji: {
    lookback: 1,
    direction: -1,
    needsTrend: null,
    detect: ([c], o) => isDojiC(c!, o) && upperShadow(c!) >= 0.6 * range(c!) && lowerShadow(c!) <= 0.1 * range(c!),
  },
  hammer: {
    lookback: 1,
    direction: 1,
    needsTrend: 'down',
    detect: ([c], o) => hammerShape(c!, o),
  },
  invertedHammer: {
    lookback: 1,
    direction: 1,
    needsTrend: 'down',
    detect: ([c], o) => invHammerShape(c!, o),
  },
  hangingMan: {
    lookback: 1,
    direction: -1,
    needsTrend: 'up',
    detect: ([c], o) => hammerShape(c!, o),
  },
  shootingStar: {
    lookback: 1,
    direction: -1,
    needsTrend: 'up',
    detect: ([c], o) => invHammerShape(c!, o),
  },
  bullishSpinningTop: {
    lookback: 1,
    direction: 1,
    needsTrend: null,
    detect: ([c], o) =>
      bull(c!) && smallBody(c!, o) && !isDojiC(c!, o) && upperShadow(c!) >= body(c!) && lowerShadow(c!) >= body(c!),
  },
  bearishSpinningTop: {
    lookback: 1,
    direction: -1,
    needsTrend: null,
    detect: ([c], o) =>
      bear(c!) && smallBody(c!, o) && !isDojiC(c!, o) && upperShadow(c!) >= body(c!) && lowerShadow(c!) >= body(c!),
  },
  bullishMarubozu: {
    lookback: 1,
    direction: 1,
    needsTrend: null,
    detect: ([c], o) => bull(c!) && upperShadow(c!) <= o.marubozuShadowMax * range(c!) && lowerShadow(c!) <= o.marubozuShadowMax * range(c!),
  },
  bearishMarubozu: {
    lookback: 1,
    direction: -1,
    needsTrend: null,
    detect: ([c], o) => bear(c!) && upperShadow(c!) <= o.marubozuShadowMax * range(c!) && lowerShadow(c!) <= o.marubozuShadowMax * range(c!),
  },

  // ---- 2 bougies
  bullishKicker: {
    lookback: 2,
    direction: 1,
    needsTrend: null,
    // deux bougies fortes + gap au-dessus de l'open précédent (rare en 24/7)
    detect: ([a, b], o) => bear(a!) && bull(b!) && b!.open > a!.open && strongBody(a!, o) && strongBody(b!, o),
  },
  bearishKicker: {
    lookback: 2,
    direction: -1,
    needsTrend: null,
    detect: ([a, b], o) => bull(a!) && bear(b!) && b!.open < a!.open && strongBody(a!, o) && strongBody(b!, o),
  },
  bullishEngulfing: {
    lookback: 2,
    direction: 1,
    needsTrend: 'down',
    detect: ([a, b]) => bear(a!) && bull(b!) && engulfsBody(b!, a!),
  },
  bearishEngulfing: {
    lookback: 2,
    direction: -1,
    needsTrend: 'up',
    detect: ([a, b]) => bull(a!) && bear(b!) && engulfsBody(b!, a!),
  },
  piercingLine: {
    lookback: 2,
    direction: 1,
    needsTrend: 'down',
    // adapté au 24/7 (pas de gap d'ouverture en crypto) : clôture au-dessus du
    // milieu du corps précédent sans le dépasser entièrement
    detect: ([a, b], o) =>
      bear(a!) && bull(b!) && strongBody(a!, o) && b!.open <= a!.close * (1 + o.nearTolerance) && b!.close > bodyMid(a!) && b!.close < a!.open,
  },
  darkCloudCover: {
    lookback: 2,
    direction: -1,
    needsTrend: 'up',
    detect: ([a, b], o) =>
      bull(a!) && bear(b!) && strongBody(a!, o) && b!.open >= a!.close * (1 - o.nearTolerance) && b!.close < bodyMid(a!) && b!.close > a!.open,
  },
  tweezerBottom: {
    lookback: 2,
    direction: 1,
    needsTrend: 'down',
    detect: ([a, b], o) => near(a!.low, b!.low, o.nearTolerance) && bear(a!) && bull(b!),
  },
  tweezerTop: {
    lookback: 2,
    direction: -1,
    needsTrend: 'up',
    detect: ([a, b], o) => near(a!.high, b!.high, o.nearTolerance) && bull(a!) && bear(b!),
  },
  bullishHarami: {
    lookback: 2,
    direction: 1,
    needsTrend: 'down',
    detect: ([a, b], o) => bear(a!) && bull(b!) && strongBody(a!, o) && smallBody(b!, o) && insideBody(b!, a!),
  },
  bearishHarami: {
    lookback: 2,
    direction: -1,
    needsTrend: 'up',
    detect: ([a, b], o) => bull(a!) && bear(b!) && strongBody(a!, o) && smallBody(b!, o) && insideBody(b!, a!),
  },

  // ---- 3 bougies
  morningStar: {
    lookback: 3,
    direction: 1,
    needsTrend: 'down',
    // l'étoile (petit corps) doit se situer SOUS le milieu du corps de la
    // première bougie — c'est elle qui marque le point bas
    detect: ([a, b, c], o) =>
      bear(a!) && strongBody(a!, o) && smallBody(b!, o) && bodyTop(b!) <= bodyMid(a!) && bull(c!) && c!.close > bodyMid(a!),
  },
  eveningStar: {
    lookback: 3,
    direction: -1,
    needsTrend: 'up',
    detect: ([a, b, c], o) =>
      bull(a!) && strongBody(a!, o) && smallBody(b!, o) && bodyBottom(b!) >= bodyMid(a!) && bear(c!) && c!.close < bodyMid(a!),
  },
  bullishAbandonedBaby: {
    lookback: 3,
    direction: 1,
    needsTrend: 'down',
    // gaps quasi inexistants en crypto : tolérance large, déclenchera rarement
    detect: ([a, b, c], o) =>
      bear(a!) && isDojiC(b!, o) && bull(c!) && b!.high < Math.min(a!.close, c!.open) * (1 + o.nearTolerance),
  },
  bearishAbandonedBaby: {
    lookback: 3,
    direction: -1,
    needsTrend: 'up',
    detect: ([a, b, c], o) =>
      bull(a!) && isDojiC(b!, o) && bear(c!) && b!.low > Math.max(a!.close, c!.open) * (1 - o.nearTolerance),
  },
  threeWhiteSoldiers: {
    lookback: 3,
    direction: 1,
    needsTrend: null,
    // trois bougies fortes qui clôturent près de leurs plus hauts, chaque
    // open à l'intérieur du corps précédent, clôtures croissantes
    detect: (w, o) =>
      w.every((c) => bull(c) && strongBody(c, o) && upperShadow(c) <= o.shortShadowMax * range(c)) &&
      w[1]!.close > w[0]!.close &&
      w[2]!.close > w[1]!.close &&
      w[1]!.open >= bodyBottom(w[0]!) - range(w[0]!) * 0.05 &&
      w[1]!.open <= bodyTop(w[0]!) + range(w[0]!) * 0.05 &&
      w[2]!.open >= bodyBottom(w[1]!) - range(w[1]!) * 0.05 &&
      w[2]!.open <= bodyTop(w[1]!) + range(w[1]!) * 0.05,
  },
  threeBlackCrows: {
    lookback: 3,
    direction: -1,
    needsTrend: null,
    detect: (w, o) =>
      w.every((c) => bear(c) && strongBody(c, o) && lowerShadow(c) <= o.shortShadowMax * range(c)) &&
      w[1]!.close < w[0]!.close &&
      w[2]!.close < w[1]!.close &&
      w[1]!.open <= bodyTop(w[0]!) + range(w[0]!) * 0.05 &&
      w[1]!.open >= bodyBottom(w[0]!) - range(w[0]!) * 0.05 &&
      w[2]!.open <= bodyTop(w[1]!) + range(w[1]!) * 0.05 &&
      w[2]!.open >= bodyBottom(w[1]!) - range(w[1]!) * 0.05,
  },
  threeInsideUp: {
    lookback: 3,
    direction: 1,
    needsTrend: 'down',
    detect: ([a, b, c], o) => bear(a!) && strongBody(a!, o) && bull(b!) && insideBody(b!, a!) && bull(c!) && c!.close > a!.open,
  },
  threeInsideDown: {
    lookback: 3,
    direction: -1,
    needsTrend: 'up',
    detect: ([a, b, c], o) => bull(a!) && strongBody(a!, o) && bear(b!) && insideBody(b!, a!) && bear(c!) && c!.close < a!.open,
  },
  threeOutsideUp: {
    lookback: 3,
    direction: 1,
    needsTrend: 'down',
    detect: ([a, b, c]) => bear(a!) && bull(b!) && engulfsBody(b!, a!) && bull(c!) && c!.close > b!.close,
  },
  threeOutsideDown: {
    lookback: 3,
    direction: -1,
    needsTrend: 'up',
    detect: ([a, b, c]) => bull(a!) && bear(b!) && engulfsBody(b!, a!) && bear(c!) && c!.close < b!.close,
  },

  // ---- 4 bougies
  bullishThreeLineStrike: {
    lookback: 4,
    direction: 1,
    needsTrend: null,
    detect: ([a, b, c, d]) =>
      bear(a!) && bear(b!) && bear(c!) && b!.close < a!.close && c!.close < b!.close && bull(d!) && d!.close > a!.open,
  },
  bearishThreeLineStrike: {
    lookback: 4,
    direction: -1,
    needsTrend: null,
    detect: ([a, b, c, d]) =>
      bull(a!) && bull(b!) && bull(c!) && b!.close > a!.close && c!.close > b!.close && bear(d!) && d!.close < a!.open,
  },

  // ---- gaps (windows) — rarissimes en crypto 24/7, fournis pour complétude
  risingWindow: {
    lookback: 2,
    direction: 1,
    needsTrend: null,
    detect: ([a, b]) => b!.low > a!.high,
  },
  fallingWindow: {
    lookback: 2,
    direction: -1,
    needsTrend: null,
    detect: ([a, b]) => b!.high < a!.low,
  },
} satisfies Record<string, Detector>

export type PatternName = keyof typeof PATTERNS

export const ALL_PATTERNS = Object.keys(PATTERNS) as PatternName[]

/** patterns dont le signal est haussier / baissier (pour filtrer rapidement) */
export const BULLISH_PATTERNS = ALL_PATTERNS.filter((n) => (PATTERNS[n] as Detector).direction === 1)
export const BEARISH_PATTERNS = ALL_PATTERNS.filter((n) => (PATTERNS[n] as Detector).direction === -1)

function trendBefore(buf: Candle[], lookback: number, o: PatternOptions): 'up' | 'down' | 'flat' {
  const endIdx = buf.length - lookback - 1 // bougie juste avant le pattern
  const startIdx = endIdx - o.trendLookback
  if (startIdx < 0) return 'flat'
  const a = buf[startIdx]!.close
  const b = buf[endIdx]!.close
  if (a <= 0) return 'flat'
  const pct = ((b - a) / a) * 100
  if (pct >= o.trendMinPct) return 'up'
  if (pct <= -o.trendMinPct) return 'down'
  return 'flat'
}

/**
 * Indicateur de détection de patterns. Une sortie par pattern demandé :
 * +1 (haussier), -1 (baissier), 0 (rien). Tracé par défaut : flèches sur les
 * bougies (plot 'markers'). Passez { plot: 'none' } pour un usage silencieux.
 *
 *   const pat = ctx.indicator('main', candlePatterns(['hammer', 'bullishEngulfing']))
 *   if (pat.value?.bullishEngulfing === 1) { ... }
 */
export function candlePatterns<const N extends readonly PatternName[]>(
  names?: N,
  opts: Partial<PatternOptions> = {},
): IndicatorSpec<Record<N extends readonly [] | undefined ? PatternName : N[number], number>> {
  const selected: readonly PatternName[] = names && names.length > 0 ? names : ALL_PATTERNS
  const o: PatternOptions = { ...DEFAULT_PATTERN_OPTIONS, ...opts }
  const maxLb = Math.max(...selected.map((n) => (PATTERNS[n] as Detector).lookback))
  const keep = maxLb + o.trendLookback + 2

  return defineIndicator({
    id: selected.length === ALL_PATTERNS.length ? 'patterns(all)' : `patterns(${selected.join('+')})`,
    outputs: selected,
    warmup: keep,
    defaultPlot: 'markers',
    create: () => {
      const buf: Candle[] = []
      return (candle) => {
        buf.push(candle)
        if (buf.length > keep + 16) buf.splice(0, buf.length - keep)
        const out: Record<string, number> = {}
        for (const name of selected) {
          const d = PATTERNS[name] as Detector
          out[name] = 0
          if (buf.length < d.lookback) continue
          if (o.requireTrend && d.needsTrend !== null && trendBefore(buf, d.lookback, o) !== d.needsTrend) continue
          const w = buf.slice(buf.length - d.lookback)
          if (d.detect(w, o)) out[name] = d.direction
        }
        return out as Record<N extends readonly [] | undefined ? PatternName : N[number], number>
      }
    },
  })
}

/** noms des patterns haussiers détectés sur la dernière bougie */
export function bullishSignals(v: Record<string, number> | null | undefined): string[] {
  if (!v) return []
  return Object.entries(v)
    .filter(([, x]) => x > 0)
    .map(([n]) => n)
}

/** noms des patterns baissiers détectés sur la dernière bougie */
export function bearishSignals(v: Record<string, number> | null | undefined): string[] {
  if (!v) return []
  return Object.entries(v)
    .filter(([, x]) => x < 0)
    .map(([n]) => n)
}
