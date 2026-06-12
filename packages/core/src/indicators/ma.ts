import { utcDayKey } from '@tpx/shared'
import { defineIndicator, sourceFn, srcId, type Source } from './types'
import { emaStream, smaStream, wmaStream } from './streams'

export const sma = (period: number, source: Source = 'close') =>
  defineIndicator({
    id: `sma(${period}${srcId(source)})`,
    warmup: period,
    defaultPlot: 'overlay',
    create: () => {
      const s = smaStream(period)
      const f = sourceFn(source)
      return (c) => s(f(c))
    },
  })

export const ema = (period: number, source: Source = 'close') =>
  defineIndicator({
    id: `ema(${period}${srcId(source)})`,
    warmup: period,
    defaultPlot: 'overlay',
    create: () => {
      const s = emaStream(period)
      const f = sourceFn(source)
      return (c) => s(f(c))
    },
  })

export const wma = (period: number, source: Source = 'close') =>
  defineIndicator({
    id: `wma(${period}${srcId(source)})`,
    warmup: period,
    defaultPlot: 'overlay',
    create: () => {
      const s = wmaStream(period)
      const f = sourceFn(source)
      return (c) => s(f(c))
    },
  })

/** Hull MA: WMA(2·WMA(n/2) − WMA(n), √n) */
export const hma = (period: number, source: Source = 'close') =>
  defineIndicator({
    id: `hma(${period}${srcId(source)})`,
    warmup: period + Math.round(Math.sqrt(period)),
    defaultPlot: 'overlay',
    create: () => {
      const half = wmaStream(Math.max(1, Math.round(period / 2)))
      const full = wmaStream(period)
      const out = wmaStream(Math.max(1, Math.round(Math.sqrt(period))))
      const f = sourceFn(source)
      return (c) => {
        const x = f(c)
        const h = half(x)
        const w = full(x)
        if (h === null || w === null) return null
        return out(2 * h - w)
      }
    },
  })

/**
 * Session-anchored VWAP (resets at UTC day or ISO week boundary), typical price.
 */
export const vwap = (anchor: 'day' | 'week' = 'day') =>
  defineIndicator({
    id: `vwap(${anchor})`,
    warmup: 1,
    defaultPlot: 'overlay',
    create: () => {
      let key = ''
      let pv = 0
      let vol = 0
      return (c) => {
        const k =
          anchor === 'day'
            ? utcDayKey(c.openTime)
            : // ISO week key: year + week index from the Monday-aligned epoch offset
              String(Math.floor((c.openTime - 4 * 86_400_000) / 604_800_000))
        if (k !== key) {
          key = k
          pv = 0
          vol = 0
        }
        const tp = (c.high + c.low + c.close) / 3
        pv += tp * c.volume
        vol += c.volume
        return vol > 0 ? pv / vol : null
      }
    },
  })

/** Rolling VWAP over the last `period` candles. */
export const rollingVwap = (period: number) =>
  defineIndicator({
    id: `rvwap(${period})`,
    warmup: period,
    defaultPlot: 'overlay',
    create: () => {
      const pvBuf = new Float64Array(period)
      const vBuf = new Float64Array(period)
      let i = 0
      let count = 0
      let pvSum = 0
      let vSum = 0
      return (c) => {
        const tp = (c.high + c.low + c.close) / 3
        if (count >= period) {
          pvSum -= pvBuf[i]!
          vSum -= vBuf[i]!
        }
        pvBuf[i] = tp * c.volume
        vBuf[i] = c.volume
        pvSum += pvBuf[i]!
        vSum += vBuf[i]!
        i = (i + 1) % period
        if (count < period) count++
        if (count < period || vSum === 0) return null
        return pvSum / vSum
      }
    },
  })
