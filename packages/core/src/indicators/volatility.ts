import type { Candle } from '@tpx/shared'
import { defineIndicator, sourceFn, srcId, type Source } from './types'
import { emaStream, highestStream, lowestStream, rmaStream, smaStream, stddevStream } from './streams'

function trueRange(c: Candle, prevClose: number | null): number {
  if (prevClose === null) return c.high - c.low
  return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose))
}

export const atr = (period = 14) =>
  defineIndicator({
    id: `atr(${period})`,
    warmup: period + 1,
    defaultPlot: 'pane',
    create: () => {
      const r = rmaStream(period)
      let prevClose: number | null = null
      return (c) => {
        const tr = trueRange(c, prevClose)
        prevClose = c.close
        return r(tr)
      }
    },
  })

export const bbands = (period = 20, mult = 2, source: Source = 'close') =>
  defineIndicator<{ upper: number; middle: number; lower: number }>({
    id: `bb(${period},${mult}${srcId(source)})`,
    outputs: ['upper', 'middle', 'lower'],
    warmup: period,
    defaultPlot: 'overlay',
    defaultColors: { upper: '#787b86', middle: '#2962ff', lower: '#787b86' },
    create: () => {
      const ma = smaStream(period)
      const sd = stddevStream(period)
      const f = sourceFn(source)
      return (c) => {
        const x = f(c)
        const m = ma(x)
        const s = sd(x)
        if (m === null || s === null) return null
        return { upper: m + mult * s, middle: m, lower: m - mult * s }
      }
    },
  })

export const keltner = (period = 20, mult = 2, atrPeriod = 10) =>
  defineIndicator<{ upper: number; middle: number; lower: number }>({
    id: `kc(${period},${mult},${atrPeriod})`,
    outputs: ['upper', 'middle', 'lower'],
    warmup: Math.max(period, atrPeriod + 1),
    defaultPlot: 'overlay',
    defaultColors: { upper: '#787b86', middle: '#2962ff', lower: '#787b86' },
    create: () => {
      const ma = emaStream(period)
      const atrS = rmaStream(atrPeriod)
      let prevClose: number | null = null
      return (c) => {
        const m = ma(c.close)
        const a = atrS(trueRange(c, prevClose))
        prevClose = c.close
        if (m === null || a === null) return null
        return { upper: m + mult * a, middle: m, lower: m - mult * a }
      }
    },
  })

/** Donchian channel over the last `period` candles (current bar included). */
export const donchian = (period = 20) =>
  defineIndicator<{ upper: number; middle: number; lower: number }>({
    id: `donchian(${period})`,
    outputs: ['upper', 'middle', 'lower'],
    warmup: period,
    defaultPlot: 'overlay',
    defaultColors: { upper: '#26a69a', middle: '#787b86', lower: '#ef5350' },
    create: () => {
      const hh = highestStream(period)
      const ll = lowestStream(period)
      return (c) => {
        const h = hh(c.high)
        const l = ll(c.low)
        if (h === null || l === null) return null
        return { upper: h, middle: (h + l) / 2, lower: l }
      }
    },
  })

export const adx = (period = 14) =>
  defineIndicator<{ adx: number; plusDi: number; minusDi: number }>({
    id: `adx(${period})`,
    outputs: ['adx', 'plusDi', 'minusDi'],
    warmup: 2 * period + 1,
    defaultPlot: 'pane',
    defaultColors: { adx: '#f23645', plusDi: '#26a69a', minusDi: '#ef5350' },
    create: () => {
      const trR = rmaStream(period)
      const pR = rmaStream(period)
      const mR = rmaStream(period)
      const aR = rmaStream(period)
      let prev: Candle | null = null
      return (c) => {
        if (!prev) {
          prev = c
          return null
        }
        const upMove = c.high - prev.high
        const downMove = prev.low - c.low
        const plusDm = upMove > downMove && upMove > 0 ? upMove : 0
        const minusDm = downMove > upMove && downMove > 0 ? downMove : 0
        const tr = trueRange(c, prev.close)
        prev = c
        const atrV = trR(tr)
        const pV = pR(plusDm)
        const mV = mR(minusDm)
        if (atrV === null || pV === null || mV === null || atrV === 0) return null
        const pDi = (100 * pV) / atrV
        const mDi = (100 * mV) / atrV
        const den = pDi + mDi
        const dx = den === 0 ? 0 : (100 * Math.abs(pDi - mDi)) / den
        const a = aR(dx)
        if (a === null) return null
        return { adx: a, plusDi: pDi, minusDi: mDi }
      }
    },
  })

/**
 * SuperTrend. direction: +1 in uptrend (line below price), -1 in downtrend.
 */
export const supertrend = (atrPeriod = 10, mult = 3) =>
  defineIndicator<{ value: number; direction: number }>({
    id: `supertrend(${atrPeriod},${mult})`,
    outputs: ['value', 'direction'],
    warmup: atrPeriod + 2,
    defaultPlot: 'overlay',
    defaultColors: { value: '#26a69a' },
    create: () => {
      const atrInst = atr(atrPeriod).create()
      let prevUpper = Number.NaN
      let prevLower = Number.NaN
      let prevClose = Number.NaN
      let dir: 1 | -1 = 1
      let started = false
      return (c) => {
        const a = atrInst.update(c)
        if (a === null) {
          prevClose = c.close
          return null
        }
        const mid = (c.high + c.low) / 2
        let upper = mid + mult * a
        let lower = mid - mult * a
        if (started) {
          // band ratcheting: bands only tighten unless price closed beyond them
          if (!(upper < prevUpper || prevClose > prevUpper)) upper = prevUpper
          if (!(lower > prevLower || prevClose < prevLower)) lower = prevLower
          if (dir === 1) {
            if (c.close < lower) dir = -1
          } else {
            if (c.close > upper) dir = 1
          }
        } else {
          dir = c.close >= mid ? 1 : -1
          started = true
        }
        prevUpper = upper
        prevLower = lower
        prevClose = c.close
        return { value: dir === 1 ? lower : upper, direction: dir }
      }
    },
  })

/**
 * Parabolic SAR — algorithme canonique de Wilder : le SAR d'une période
 * haussière ne peut pas dépasser le plus bas des DEUX bougies précédentes
 * (symétriquement en baisse), accélération af bornée à `max`.
 */
export const psar = (start = 0.02, step = 0.02, max = 0.2) =>
  defineIndicator({
    id: `psar(${start},${step},${max})`,
    warmup: 3,
    defaultPlot: 'overlay',
    create: () => {
      let prev: Candle | null = null
      let prev2: Candle | null = null
      let sar = 0
      let ep = 0
      let af = start
      let up = true
      let started = false
      return (c) => {
        if (!prev) {
          prev = c
          return null
        }
        if (!started) {
          up = c.close >= prev.close
          sar = up ? Math.min(prev.low, c.low) : Math.max(prev.high, c.high)
          ep = up ? Math.max(prev.high, c.high) : Math.min(prev.low, c.low)
          af = start
          started = true
          prev2 = prev
          prev = c
          return sar
        }
        sar = sar + af * (ep - sar)
        if (up) {
          sar = Math.min(sar, prev.low, prev2?.low ?? prev.low)
          if (c.high > ep) {
            ep = c.high
            af = Math.min(max, af + step)
          }
          if (c.low < sar) {
            up = false
            sar = ep
            ep = c.low
            af = start
          }
        } else {
          sar = Math.max(sar, prev.high, prev2?.high ?? prev.high)
          if (c.low < ep) {
            ep = c.low
            af = Math.min(max, af + step)
          }
          if (c.high > sar) {
            up = true
            sar = ep
            ep = c.high
            af = start
          }
        }
        prev2 = prev
        prev = c
        return sar
      }
    },
  })
