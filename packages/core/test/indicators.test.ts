import { describe, expect, it } from 'bun:test'
import type { Candle } from '@tpx/shared'
import { emaStream, highestStream, lowestStream, smaStream, stddevStream } from '../src/indicators/streams'
import { atr, bbands, donchian, supertrend } from '../src/indicators/volatility'
import { macd, rsi } from '../src/indicators/oscillators'
import { BoundIndicator } from '../src/indicators/bound'
import { ema } from '../src/indicators/ma'
import { crossover, crossunder } from '../src/ta'

function mkCandle(i: number, o: number, h: number, l: number, c: number, v = 100): Candle {
  const openTime = i * 60_000
  return {
    openTime,
    open: o,
    high: h,
    low: l,
    close: c,
    volume: v,
    quoteVolume: v * c,
    trades: 10,
    takerBuyBase: v / 2,
    takerBuyQuote: (v / 2) * c,
    closeTime: openTime + 59_999,
  }
}

const flat = (i: number, price: number) => mkCandle(i, price, price, price, price)

describe('streams', () => {
  it('sma', () => {
    const s = smaStream(3)
    expect([1, 2, 3, 4, 5].map(s)).toEqual([null, null, 2, 3, 4])
  })

  it('ema seeded with sma', () => {
    const s = emaStream(3)
    expect([1, 2, 3, 4, 5].map(s)).toEqual([null, null, 2, 3, 4])
  })

  it('highest/lowest deques', () => {
    const h = highestStream(3)
    expect([1, 3, 2, 5, 4].map(h)).toEqual([null, null, 3, 5, 5])
    const l = lowestStream(3)
    expect([5, 3, 4, 1, 2].map(l)).toEqual([null, null, 3, 1, 1])
  })

  it('population stddev', () => {
    const s = stddevStream(4)
    s(2)
    s(4)
    s(4)
    const v = s(6)
    expect(v).toBeCloseTo(Math.sqrt(2), 10)
  })
})

describe('indicators', () => {
  it('rsi saturates at 100 on monotonic rise and 0 on fall', () => {
    const up = rsi(14).create()
    let lastUp: number | null = null
    for (let i = 0; i < 30; i++) lastUp = up.update(flat(i, 100 + i))
    expect(lastUp).toBe(100)

    const down = rsi(14).create()
    let lastDown: number | null = null
    for (let i = 0; i < 30; i++) lastDown = down.update(flat(i, 100 - i))
    expect(lastDown).toBe(0)
  })

  it('atr equals constant true range on a steady series', () => {
    const a = atr(5).create()
    let v: number | null = null
    for (let i = 0; i < 30; i++) v = a.update(mkCandle(i, 100, 102, 98, 100))
    expect(v).toBeCloseTo(4, 6)
  })

  it('bollinger collapses to the mean on constant prices', () => {
    const b = bbands(10, 2).create()
    let v: { upper: number; middle: number; lower: number } | null = null
    for (let i = 0; i < 15; i++) v = b.update(flat(i, 50))
    expect(v).not.toBeNull()
    expect(v!.middle).toBeCloseTo(50, 9)
    expect(v!.upper).toBeCloseTo(50, 9)
  })

  it('donchian tracks the rolling extremes', () => {
    const d = donchian(3).create()
    d.update(mkCandle(0, 10, 12, 8, 10))
    d.update(mkCandle(1, 10, 15, 9, 14))
    const v = d.update(mkCandle(2, 14, 14, 11, 12))
    expect(v).toEqual({ upper: 15, middle: 11.5, lower: 8 })
  })

  it('macd warms up and produces coherent outputs', () => {
    const m = macd(3, 6, 3).create()
    let v: { macd: number; signal: number; hist: number } | null = null
    for (let i = 0; i < 30; i++) v = m.update(flat(i, 100 + i))
    expect(v).not.toBeNull()
    expect(v!.hist).toBeCloseTo(v!.macd - v!.signal, 10)
    expect(v!.macd).toBeGreaterThan(0) // rising series
  })

  it('supertrend flips direction with the trend', () => {
    const st = supertrend(5, 2).create()
    let v: { value: number; direction: number } | null = null
    for (let i = 0; i < 20; i++) v = st.update(mkCandle(i, 100 + i, 101 + i, 99 + i, 100.5 + i))
    expect(v!.direction).toBe(1)
    for (let i = 20; i < 60; i++) {
      const p = 120 - (i - 20) * 2
      v = st.update(mkCandle(i, p, p + 1, p - 1, p - 0.5))
    }
    expect(v!.direction).toBe(-1)
  })
})

describe('bound indicators + ta helpers', () => {
  it('lookback access and crossover detection', () => {
    const bound = new BoundIndicator('main', ema(3))
    const prices = [10, 10, 10, 10, 5, 5, 5, 5, 30]
    for (let i = 0; i < prices.length; i++) bound.update(i * 60_000, flat(i, prices[i]!))
    expect(bound.ready).toBe(true)
    expect(bound.at(0)).not.toBeNull()
    expect(bound.at(1)).not.toBeNull()
    expect(bound.at(500)).toBeNull()

    // closes crossed above the ema on the last bar
    const closes = {
      at: (lb: number) => prices[prices.length - 1 - lb] ?? null,
      get value() {
        return prices[prices.length - 1] ?? null
      },
    }
    expect(crossover(closes, bound.out())).toBe(true)
    expect(crossunder(closes, bound.out())).toBe(false)
  })

  it('multi-output handles expose per-output series', () => {
    const bound = new BoundIndicator('main', macd(3, 6, 3))
    for (let i = 0; i < 30; i++) bound.update(i * 60_000, flat(i, 100 + i))
    const hist = bound.out('hist')
    expect(hist.value).not.toBeNull()
    expect(() => bound.out('nope')).toThrow()
    const dtos = bound.toSeriesDTO()
    expect(dtos.map((d) => d.output).sort()).toEqual(['hist', 'macd', 'signal'])
    expect(dtos[0]!.points.length).toBe(30)
  })
})
