import { defineIndicator, sourceFn, srcId, type Source } from './types'
import { emaStream, highestStream, lagStream, lowestStream, rmaStream, smaStream } from './streams'

export const rsi = (period = 14, source: Source = 'close') =>
  defineIndicator({
    id: `rsi(${period}${srcId(source)})`,
    warmup: period + 1,
    defaultPlot: 'pane',
    defaultColors: { value: '#7e57c2' },
    create: () => {
      const up = rmaStream(period)
      const down = rmaStream(period)
      const f = sourceFn(source)
      let prev: number | null = null
      return (c) => {
        const x = f(c)
        if (prev === null) {
          prev = x
          return null
        }
        const d = x - prev
        prev = x
        const u = up(Math.max(d, 0))
        const dn = down(Math.max(-d, 0))
        if (u === null || dn === null) return null
        if (dn === 0) return 100
        return 100 - 100 / (1 + u / dn)
      }
    },
  })

export const macd = (fast = 12, slow = 26, signal = 9, source: Source = 'close') =>
  defineIndicator<{ macd: number; signal: number; hist: number }>({
    id: `macd(${fast},${slow},${signal}${srcId(source)})`,
    outputs: ['macd', 'signal', 'hist'],
    warmup: slow + signal,
    defaultPlot: 'pane',
    defaultColors: { macd: '#2962ff', signal: '#ff6d00', hist: '#26a69a' },
    create: () => {
      const fastS = emaStream(fast)
      const slowS = emaStream(slow)
      const sigS = emaStream(signal)
      const f = sourceFn(source)
      return (c) => {
        const x = f(c)
        const ef = fastS(x)
        const es = slowS(x)
        if (ef === null || es === null) return null
        const m = ef - es
        const sg = sigS(m)
        if (sg === null) return null
        return { macd: m, signal: sg, hist: m - sg }
      }
    },
  })

export const stoch = (kPeriod = 14, kSmooth = 3, dPeriod = 3) =>
  defineIndicator<{ k: number; d: number }>({
    id: `stoch(${kPeriod},${kSmooth},${dPeriod})`,
    outputs: ['k', 'd'],
    warmup: kPeriod + kSmooth + dPeriod,
    defaultPlot: 'pane',
    defaultColors: { k: '#2962ff', d: '#ff6d00' },
    create: () => {
      const hh = highestStream(kPeriod)
      const ll = lowestStream(kPeriod)
      const kS = smaStream(kSmooth)
      const dS = smaStream(dPeriod)
      return (c) => {
        const h = hh(c.high)
        const l = ll(c.low)
        if (h === null || l === null) return null
        const raw = h === l ? 50 : (100 * (c.close - l)) / (h - l)
        const k = kS(raw)
        if (k === null) return null
        const d = dS(k)
        if (d === null) return null
        return { k, d }
      }
    },
  })

export const stochRsi = (rsiPeriod = 14, stochPeriod = 14, kSmooth = 3, dSmooth = 3) =>
  defineIndicator<{ k: number; d: number }>({
    id: `stochrsi(${rsiPeriod},${stochPeriod},${kSmooth},${dSmooth})`,
    outputs: ['k', 'd'],
    warmup: rsiPeriod + stochPeriod + kSmooth + dSmooth + 1,
    defaultPlot: 'pane',
    defaultColors: { k: '#2962ff', d: '#ff6d00' },
    create: () => {
      const rsiInst = rsi(rsiPeriod).create()
      const hh = highestStream(stochPeriod)
      const ll = lowestStream(stochPeriod)
      const kS = smaStream(kSmooth)
      const dS = smaStream(dSmooth)
      return (c) => {
        const r = rsiInst.update(c)
        if (r === null) return null
        const h = hh(r)
        const l = ll(r)
        if (h === null || l === null) return null
        const raw = h === l ? 50 : (100 * (r - l)) / (h - l)
        const k = kS(raw)
        if (k === null) return null
        const d = dS(k)
        if (d === null) return null
        return { k, d }
      }
    },
  })

export const cci = (period = 20) =>
  defineIndicator({
    id: `cci(${period})`,
    warmup: period,
    defaultPlot: 'pane',
    create: () => {
      const ma = smaStream(period)
      const buf: number[] = []
      return (c) => {
        const tp = (c.high + c.low + c.close) / 3
        buf.push(tp)
        if (buf.length > period) buf.shift()
        const m = ma(tp)
        if (m === null) return null
        let dev = 0
        for (const v of buf) dev += Math.abs(v - m)
        dev /= period
        return dev === 0 ? 0 : (tp - m) / (0.015 * dev)
      }
    },
  })

export const mfi = (period = 14) =>
  defineIndicator({
    id: `mfi(${period})`,
    warmup: period + 1,
    defaultPlot: 'pane',
    create: () => {
      const pos: number[] = []
      const neg: number[] = []
      let posSum = 0
      let negSum = 0
      let prevTp: number | null = null
      return (c) => {
        const tp = (c.high + c.low + c.close) / 3
        if (prevTp === null) {
          prevTp = tp
          return null
        }
        const mf = tp * c.volume
        const p = tp > prevTp ? mf : 0
        const n = tp < prevTp ? mf : 0
        prevTp = tp
        pos.push(p)
        posSum += p
        neg.push(n)
        negSum += n
        if (pos.length > period) {
          posSum -= pos.shift()!
          negSum -= neg.shift()!
        }
        if (pos.length < period) return null
        if (negSum === 0) return 100
        return 100 - 100 / (1 + posSum / negSum)
      }
    },
  })

export const obv = () =>
  defineIndicator({
    id: 'obv',
    warmup: 2,
    defaultPlot: 'pane',
    create: () => {
      let prevClose: number | null = null
      let value = 0
      return (c) => {
        if (prevClose === null) {
          prevClose = c.close
          return null
        }
        if (c.close > prevClose) value += c.volume
        else if (c.close < prevClose) value -= c.volume
        prevClose = c.close
        return value
      }
    },
  })

/** Rate of change, percent: 100·(x − x[n]) / x[n] */
export const roc = (period = 10, source: Source = 'close') =>
  defineIndicator({
    id: `roc(${period}${srcId(source)})`,
    warmup: period + 1,
    defaultPlot: 'pane',
    create: () => {
      const lag = lagStream(period)
      const f = sourceFn(source)
      return (c) => {
        const x = f(c)
        const old = lag(x)
        if (old === null || old === 0) return null
        return (100 * (x - old)) / old
      }
    },
  })

/** Williams %R, in [-100, 0]. */
export const willr = (period = 14) =>
  defineIndicator({
    id: `willr(${period})`,
    warmup: period,
    defaultPlot: 'pane',
    create: () => {
      const hh = highestStream(period)
      const ll = lowestStream(period)
      return (c) => {
        const h = hh(c.high)
        const l = ll(c.low)
        if (h === null || l === null) return null
        if (h === l) return -50
        return (-100 * (h - c.close)) / (h - l)
      }
    },
  })
