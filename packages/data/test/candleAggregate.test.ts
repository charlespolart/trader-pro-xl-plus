import { describe, expect, it } from 'bun:test'
import type { Candle } from '@tpx/shared'
import { aggregateDailyCandles } from '../src/store/candleStore'

const DAY = 86_400_000

function day(idx: number, close: number): Candle {
  return {
    openTime: idx * DAY,
    open: close - 1,
    high: close + 2,
    low: close - 3,
    close,
    volume: 10,
    quoteVolume: 100,
    trades: 5,
    takerBuyBase: 4,
    takerBuyQuote: 40,
    closeTime: idx * DAY + DAY - 1,
  }
}

describe('aggregateDailyCandles', () => {
  it('builds 3d bars on the Binance grid (open day ≡ 1 mod 3), skipping partial buckets', () => {
    // jours 17395..17402 : buckets complets [17395..17397], [17398..17400] ; 17401-17402 partiel
    const days = [17395, 17396, 17397, 17398, 17399, 17400, 17401, 17402].map((i) => day(i, i))
    const rows = aggregateDailyCandles(days, '3d')
    expect(rows.length).toBe(2)
    expect(rows[0]!.openTime).toBe(17395 * DAY)
    expect(rows[0]!.open).toBe(17395 - 1)
    expect(rows[0]!.close).toBe(17397)
    expect(rows[0]!.high).toBe(17397 + 2)
    expect(rows[0]!.low).toBe(17395 - 3)
    expect(rows[0]!.volume).toBe(30)
    expect(rows[0]!.trades).toBe(15)
    expect(rows[0]!.takerBuyBase).toBe(12)
    expect(rows[0]!.closeTime).toBe(17398 * DAY - 1)
    expect(rows[1]!.openTime).toBe(17398 * DAY)
  })

  it('drops a bucket with a missing day (never emits a wrong OHLC)', () => {
    const days = [17395, 17397, 17398, 17399, 17400].map((i) => day(i, i)) // 17396 manquant
    const rows = aggregateDailyCandles(days, '3d')
    expect(rows.length).toBe(1)
    expect(rows[0]!.openTime).toBe(17398 * DAY)
  })

  it('builds Monday-aligned weekly bars', () => {
    // 17392 = lundi ; deux semaines complètes + un lundi orphelin
    const days = Array.from({ length: 15 }, (_, k) => day(17392 + k, k + 1))
    const rows = aggregateDailyCandles(days, '1w')
    expect(rows.length).toBe(2)
    expect(rows[0]!.openTime).toBe(17392 * DAY)
    expect(rows[0]!.close).toBe(7)
    expect(rows[1]!.openTime).toBe(17399 * DAY)
    expect(rows[1]!.close).toBe(14)
  })

  it('handles leading days that belong to an incomplete first bucket', () => {
    // premier jour 17396 → le bucket [17395..17397] est incomplet → seul [17398..] sort
    const days = [17396, 17397, 17398, 17399, 17400].map((i) => day(i, i))
    const rows = aggregateDailyCandles(days, '3d')
    expect(rows.length).toBe(1)
    expect(rows[0]!.openTime).toBe(17398 * DAY)
  })
})
