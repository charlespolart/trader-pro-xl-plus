import { describe, expect, it } from 'bun:test'
import { alignOpenTime } from '../src/market'

const DAY = 86_400_000

describe('alignOpenTime', () => {
  it('aligns 1w to Mondays (Binance grid)', () => {
    // 2017-08-14 était un lundi (jour 17392 ≡ 4 mod 7)
    const monday = 17392 * DAY
    expect(alignOpenTime(monday, '1w')).toBe(monday)
    expect(alignOpenTime(monday + 3 * DAY + 123, '1w')).toBe(monday)
    expect(alignOpenTime(monday + 7 * DAY, '1w')).toBe(monday + 7 * DAY)
  })

  it('aligns 3d to the Binance global grid (day index ≡ 1 mod 3, NOT epoch multiples)', () => {
    // Premier 3d spot BTCUSDT : 2017-08-17 = jour 17395 (17395 % 3 === 1)
    const barOpen = 17395 * DAY
    expect(alignOpenTime(barOpen, '3d')).toBe(barOpen)
    expect(alignOpenTime(barOpen + DAY, '3d')).toBe(barOpen)
    expect(alignOpenTime(barOpen + 2 * DAY + 999, '3d')).toBe(barOpen)
    expect(alignOpenTime(barOpen + 3 * DAY, '3d')).toBe(barOpen + 3 * DAY)
    // un multiple d'epoch (jour ≡ 0 mod 3) appartient à la bougie ouverte la veille
    const epochMult = 17394 * DAY
    expect(alignOpenTime(epochMult, '3d')).toBe(epochMult - 2 * DAY)
  })

  it('aligns sub-day intervals to epoch multiples', () => {
    expect(alignOpenTime(3 * 3_600_000 + 5, '1h')).toBe(3 * 3_600_000)
    expect(alignOpenTime(17395 * DAY + 5 * 3_600_000, '4h')).toBe(17395 * DAY + 4 * 3_600_000)
  })
})
