import { describe, expect, it } from 'bun:test'
import type { Candle } from '@tpx/shared'
import type { IndicatorSpec } from '../src/indicators/types'
import { ema, hma, sma, wma } from '../src/indicators/ma'
import { cci, macd, mfi, obv, roc, rsi, stoch, willr } from '../src/indicators/oscillators'
import { adx, atr, bbands, donchian, keltner } from '../src/indicators/volatility'

/**
 * Vérification des implémentations incrémentales contre des implémentations
 * de référence « au pied de la lettre » (formules textbook, calcul direct sur
 * tableaux). Conventions suivies (TA-Lib / TradingView) :
 *  - EMA amorcée par la SMA des `period` premières valeurs
 *  - lissage de Wilder (RMA, alpha = 1/period) amorcé par la SMA — RSI/ATR/ADX
 *  - écart-type de POPULATION pour les bandes de Bollinger (Pine biased=true)
 *  - Stochastique lent : %K = SMA(raw, kSmooth), %D = SMA(%K, dPeriod)
 * On vérifie les valeurs (erreur relative < 1e-9) ET l'index de première
 * valeur non nulle (convention de warmup).
 */

// ---------------------------------------------------- marche aléatoire LCG
function makeWalk(n: number, seed = 42): Candle[] {
  let s = seed >>> 0
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
  const out: Candle[] = []
  let close = 100
  for (let i = 0; i < n; i++) {
    const open = close
    close = Math.max(1, open * (1 + (rnd() - 0.5) * 0.04))
    const high = Math.max(open, close) * (1 + rnd() * 0.01)
    const low = Math.min(open, close) * (1 - rnd() * 0.01)
    const volume = 50 + rnd() * 200
    out.push({
      openTime: i * 60_000,
      open,
      high,
      low,
      close,
      volume,
      quoteVolume: volume * close,
      trades: 10,
      takerBuyBase: volume / 2,
      takerBuyQuote: (volume / 2) * close,
      closeTime: i * 60_000 + 59_999,
    })
  }
  return out
}

const CANDLES = makeWalk(400)
const CLOSES = CANDLES.map((c) => c.close)

// ----------------------------------------------------------- refs « manuel »
type Seq = (number | null)[]

function smaRef(xs: number[], p: number): Seq {
  return xs.map((_, i) => {
    if (i < p - 1) return null
    let s = 0
    for (let j = i - p + 1; j <= i; j++) s += xs[j]!
    return s / p
  })
}

function emaLikeRef(xs: number[], p: number, alpha: number): Seq {
  const out: Seq = xs.map(() => null)
  let v: number | null = null
  for (let i = 0; i < xs.length; i++) {
    if (i === p - 1) {
      let s = 0
      for (let j = 0; j < p; j++) s += xs[j]!
      v = s / p
    } else if (i >= p) {
      v = alpha * xs[i]! + (1 - alpha) * (v as number)
    }
    out[i] = v
  }
  return out
}

const emaRef = (xs: number[], p: number): Seq => emaLikeRef(xs, p, 2 / (p + 1))
const rmaRef = (xs: number[], p: number): Seq => emaLikeRef(xs, p, 1 / p)

function wmaRef(xs: number[], p: number): Seq {
  const denom = (p * (p + 1)) / 2
  return xs.map((_, i) => {
    if (i < p - 1) return null
    let num = 0
    for (let k = 0; k < p; k++) num += xs[i - p + 1 + k]! * (k + 1)
    return num / denom
  })
}

function rsiRef(xs: number[], p: number): Seq {
  const gains: number[] = []
  const losses: number[] = []
  for (let i = 1; i < xs.length; i++) {
    const d = xs[i]! - xs[i - 1]!
    gains.push(Math.max(d, 0))
    losses.push(Math.max(-d, 0))
  }
  const g = rmaRef(gains, p)
  const l = rmaRef(losses, p)
  const out: Seq = xs.map(() => null)
  for (let i = 0; i < gains.length; i++) {
    if (g[i] === null) continue
    out[i + 1] = l[i] === 0 ? 100 : 100 - 100 / (1 + g[i]! / l[i]!)
  }
  return out
}

function trSeries(cs: Candle[]): number[] {
  return cs.map((c, i) =>
    i === 0 ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - cs[i - 1]!.close), Math.abs(c.low - cs[i - 1]!.close)),
  )
}

const atrRef = (cs: Candle[], p: number): Seq => rmaRef(trSeries(cs), p)

function adxRef(cs: Candle[], p: number): { adx: Seq; plusDi: Seq; minusDi: Seq } {
  const pdm: number[] = []
  const mdm: number[] = []
  const tr: number[] = []
  for (let i = 1; i < cs.length; i++) {
    const up = cs[i]!.high - cs[i - 1]!.high
    const dn = cs[i - 1]!.low - cs[i]!.low
    pdm.push(up > dn && up > 0 ? up : 0)
    mdm.push(dn > up && dn > 0 ? dn : 0)
    tr.push(
      Math.max(cs[i]!.high - cs[i]!.low, Math.abs(cs[i]!.high - cs[i - 1]!.close), Math.abs(cs[i]!.low - cs[i - 1]!.close)),
    )
  }
  const sTr = rmaRef(tr, p)
  const sP = rmaRef(pdm, p)
  const sM = rmaRef(mdm, p)
  const dxDense: number[] = []
  const plusDi: Seq = cs.map(() => null)
  const minusDi: Seq = cs.map(() => null)
  const adxOut: Seq = cs.map(() => null)
  const dxIndex: number[] = []
  for (let i = 0; i < tr.length; i++) {
    if (sTr[i] === null || sTr[i] === 0) continue
    const pdi = (100 * sP[i]!) / sTr[i]!
    const mdi = (100 * sM[i]!) / sTr[i]!
    plusDi[i + 1] = pdi
    minusDi[i + 1] = mdi
    const den = pdi + mdi
    dxDense.push(den === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / den)
    dxIndex.push(i + 1)
  }
  const sDx = rmaRef(dxDense, p)
  for (let k = 0; k < dxDense.length; k++) {
    if (sDx[k] !== null) adxOut[dxIndex[k]!] = sDx[k]
  }
  // plusDi/minusDi ne sont exposés qu'à partir du premier ADX (sortie groupée)
  for (let i = 0; i < cs.length; i++) {
    if (adxOut[i] === null) {
      plusDi[i] = null
      minusDi[i] = null
    }
  }
  return { adx: adxOut, plusDi, minusDi }
}

function stochRef(cs: Candle[], k: number, kSmooth: number, d: number): { k: Seq; d: Seq } {
  const rawDense: number[] = []
  const rawIdx: number[] = []
  for (let i = k - 1; i < cs.length; i++) {
    let h = -Infinity
    let l = Infinity
    for (let j = i - k + 1; j <= i; j++) {
      h = Math.max(h, cs[j]!.high)
      l = Math.min(l, cs[j]!.low)
    }
    rawDense.push(h === l ? 50 : (100 * (cs[i]!.close - l)) / (h - l))
    rawIdx.push(i)
  }
  const kDense = smaRef(rawDense, kSmooth)
  const kVals: number[] = []
  const kIdx: number[] = []
  for (let m = 0; m < kDense.length; m++) {
    if (kDense[m] !== null) {
      kVals.push(kDense[m]!)
      kIdx.push(rawIdx[m]!)
    }
  }
  const dDense = smaRef(kVals, d)
  const outK: Seq = cs.map(() => null)
  const outD: Seq = cs.map(() => null)
  for (let m = 0; m < kVals.length; m++) {
    if (dDense[m] !== null) {
      outK[kIdx[m]!] = kVals[m]!
      outD[kIdx[m]!] = dDense[m]!
    }
  }
  return { k: outK, d: outD }
}

function cciRef(cs: Candle[], p: number): Seq {
  const tp = cs.map((c) => (c.high + c.low + c.close) / 3)
  return cs.map((_, i) => {
    if (i < p - 1) return null
    let m = 0
    for (let j = i - p + 1; j <= i; j++) m += tp[j]!
    m /= p
    let dev = 0
    for (let j = i - p + 1; j <= i; j++) dev += Math.abs(tp[j]! - m)
    dev /= p
    return dev === 0 ? 0 : (tp[i]! - m) / (0.015 * dev)
  })
}

function mfiRef(cs: Candle[], p: number): Seq {
  const tp = cs.map((c) => (c.high + c.low + c.close) / 3)
  return cs.map((_, i) => {
    if (i < p) return null
    let pos = 0
    let neg = 0
    for (let j = i - p + 1; j <= i; j++) {
      const mf = tp[j]! * cs[j]!.volume
      if (tp[j]! > tp[j - 1]!) pos += mf
      else if (tp[j]! < tp[j - 1]!) neg += mf
    }
    if (neg === 0) return 100
    return 100 - 100 / (1 + pos / neg)
  })
}

function bbandsRef(xs: number[], p: number, mult: number): { upper: Seq; middle: Seq; lower: Seq } {
  const middle = smaRef(xs, p)
  const upper: Seq = xs.map(() => null)
  const lower: Seq = xs.map(() => null)
  for (let i = p - 1; i < xs.length; i++) {
    const m = middle[i]!
    let v = 0
    for (let j = i - p + 1; j <= i; j++) v += (xs[j]! - m) ** 2
    const sd = Math.sqrt(v / p)
    upper[i] = m + mult * sd
    lower[i] = m - mult * sd
  }
  return { upper, middle, lower }
}

// --------------------------------------------------------------- harnais
function runSingle(spec: IndicatorSpec<number>): Seq {
  const inst = spec.create()
  return CANDLES.map((c) => inst.update(c))
}

function runMulti<O extends Record<string, number>>(spec: IndicatorSpec<O>, key: keyof O & string): Seq {
  const inst = spec.create()
  return CANDLES.map((c) => {
    const v = inst.update(c)
    return v === null ? null : v[key]
  })
}

function firstIdx(s: Seq): number {
  return s.findIndex((v) => v !== null)
}

function compare(actual: Seq, ref: Seq, label: string): void {
  expect(firstIdx(actual)).toBe(firstIdx(ref))
  let maxErr = 0
  for (let i = 0; i < ref.length; i++) {
    const a = actual[i]
    const r = ref[i]
    if (a === null || r === null) {
      expect(a === null).toBe(r === null)
      continue
    }
    const scale = Math.max(1, Math.abs(r))
    maxErr = Math.max(maxErr, Math.abs(a - r) / scale)
  }
  if (maxErr >= 1e-9) throw new Error(`${label}: erreur relative max ${maxErr}`)
}

// ------------------------------------------------------------------ tests
describe('indicateurs vs implémentations de référence (textbook)', () => {
  it('SMA / EMA / WMA / HMA', () => {
    compare(runSingle(sma(20)), smaRef(CLOSES, 20), 'sma(20)')
    compare(runSingle(ema(21)), emaRef(CLOSES, 21), 'ema(21)')
    compare(runSingle(wma(14)), wmaRef(CLOSES, 14), 'wma(14)')
    // HMA(n) = WMA(2·WMA(n/2) − WMA(n), √n) — composition de refs
    const n = 16
    const half = wmaRef(CLOSES, Math.max(1, Math.round(n / 2)))
    const full = wmaRef(CLOSES, n)
    const diffDense: number[] = []
    const idx: number[] = []
    for (let i = 0; i < CLOSES.length; i++) {
      if (half[i] !== null && full[i] !== null) {
        diffDense.push(2 * half[i]! - full[i]!)
        idx.push(i)
      }
    }
    const outDense = wmaRef(diffDense, Math.max(1, Math.round(Math.sqrt(n))))
    const hmaRef: Seq = CLOSES.map(() => null)
    for (let m = 0; m < diffDense.length; m++) {
      if (outDense[m] !== null) hmaRef[idx[m]!] = outDense[m]!
    }
    compare(runSingle(hma(n)), hmaRef, 'hma(16)')
  })

  it('RSI (Wilder, amorçage SMA)', () => {
    compare(runSingle(rsi(14)), rsiRef(CLOSES, 14), 'rsi(14)')
    compare(runSingle(rsi(7)), rsiRef(CLOSES, 7), 'rsi(7)')
  })

  it('ATR (true range + lissage de Wilder)', () => {
    compare(runSingle(atr(14)), atrRef(CANDLES, 14), 'atr(14)')
  })

  it('ADX / +DI / -DI (Wilder)', () => {
    const ref = adxRef(CANDLES, 14)
    compare(runMulti(adx(14), 'adx'), ref.adx, 'adx')
    compare(runMulti(adx(14), 'plusDi'), ref.plusDi, '+di')
    compare(runMulti(adx(14), 'minusDi'), ref.minusDi, '-di')
  })

  it('Stochastique lent (%K lissé, %D)', () => {
    const ref = stochRef(CANDLES, 14, 3, 3)
    compare(runMulti(stoch(14, 3, 3), 'k'), ref.k, 'stoch %K')
    compare(runMulti(stoch(14, 3, 3), 'd'), ref.d, 'stoch %D')
  })

  it('MACD (EMA12/26 + signal EMA9)', () => {
    const f = emaRef(CLOSES, 12)
    const s = emaRef(CLOSES, 26)
    const diffDense: number[] = []
    const idx: number[] = []
    for (let i = 0; i < CLOSES.length; i++) {
      if (f[i] !== null && s[i] !== null) {
        diffDense.push(f[i]! - s[i]!)
        idx.push(i)
      }
    }
    const sigDense = emaRef(diffDense, 9)
    const refMacd: Seq = CLOSES.map(() => null)
    for (let m = 0; m < diffDense.length; m++) {
      if (sigDense[m] !== null) refMacd[idx[m]!] = diffDense[m]!
    }
    compare(runMulti(macd(12, 26, 9), 'macd'), refMacd, 'macd line')
  })

  it('CCI / MFI / ROC / Williams %R / OBV', () => {
    compare(runSingle(cci(20)), cciRef(CANDLES, 20), 'cci(20)')
    compare(runSingle(mfi(14)), mfiRef(CANDLES, 14), 'mfi(14)')
    const rocRef: Seq = CLOSES.map((x, i) => (i < 10 ? null : (100 * (x - CLOSES[i - 10]!)) / CLOSES[i - 10]!))
    compare(runSingle(roc(10)), rocRef, 'roc(10)')
    const willrRef: Seq = CANDLES.map((c, i) => {
      if (i < 13) return null
      let h = -Infinity
      let l = Infinity
      for (let j = i - 13; j <= i; j++) {
        h = Math.max(h, CANDLES[j]!.high)
        l = Math.min(l, CANDLES[j]!.low)
      }
      return h === l ? -50 : (-100 * (h - c.close)) / (h - l)
    })
    compare(runSingle(willr(14)), willrRef, 'willr(14)')
    let cum = 0
    const obvRef: Seq = CANDLES.map((c, i) => {
      if (i === 0) return null
      if (c.close > CANDLES[i - 1]!.close) cum += c.volume
      else if (c.close < CANDLES[i - 1]!.close) cum -= c.volume
      return cum
    })
    compare(runSingle(obv()), obvRef, 'obv')
  })

  it('Bollinger (écart-type de population) / Donchian / Keltner', () => {
    const bb = bbandsRef(CLOSES, 20, 2)
    compare(runMulti(bbands(20, 2), 'upper'), bb.upper, 'bb upper')
    compare(runMulti(bbands(20, 2), 'middle'), bb.middle, 'bb middle')
    compare(runMulti(bbands(20, 2), 'lower'), bb.lower, 'bb lower')

    const donUpper: Seq = CANDLES.map((_, i) => {
      if (i < 19) return null
      let h = -Infinity
      for (let j = i - 19; j <= i; j++) h = Math.max(h, CANDLES[j]!.high)
      return h
    })
    compare(runMulti(donchian(20), 'upper'), donUpper, 'donchian upper')

    // Keltner : EMA(20) ± 2·RMA(TR, 10)
    const mid = emaRef(CLOSES, 20)
    const a = rmaRef(trSeries(CANDLES), 10)
    const kcUpper: Seq = CLOSES.map((_, i) => (mid[i] !== null && a[i] !== null ? mid[i]! + 2 * a[i]! : null))
    compare(runMulti(keltner(20, 2, 10), 'upper'), kcUpper, 'keltner upper')
  })
})
