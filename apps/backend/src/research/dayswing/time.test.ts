import { describe, expect, it } from 'bun:test'
import { isEdt, nyDow, nyHour, nyOffsetHours } from './time'

// Frontières DST US officielles (2ᵉ dim. mars / 1ᵉʳ dim. novembre)
const BOUNDS: Array<[number, string, string]> = [
  [2019, '2019-03-10', '2019-11-03'],
  [2022, '2022-03-13', '2022-11-06'],
  [2024, '2024-03-10', '2024-11-03'],
  [2025, '2025-03-09', '2025-11-02'],
  [2026, '2026-03-08', '2026-11-01'],
]

describe('US DST rule', () => {
  for (const [year, start, end] of BOUNDS) {
    it(`year ${year}: starts ${start} 07:00Z, ends ${end} 06:00Z`, () => {
      const s = Date.parse(`${start}T07:00:00Z`)
      const e = Date.parse(`${end}T06:00:00Z`)
      expect(isEdt(s - 1)).toBe(false)
      expect(isEdt(s)).toBe(true)
      expect(isEdt(e - 1)).toBe(true)
      expect(isEdt(e)).toBe(false)
    })
  }

  it('january/december are EST (UTC-5)', () => {
    expect(nyOffsetHours(Date.parse('2024-01-15T12:00:00Z'))).toBe(-5)
    expect(nyOffsetHours(Date.parse('2024-12-15T12:00:00Z'))).toBe(-5)
  })

  it('nyHour converts wall-clock correctly', () => {
    // été : 13:30 UTC = 9:30 NY (EDT)
    expect(nyHour(Date.parse('2024-06-15T13:30:00Z'))).toBe(9)
    // hiver : 14:30 UTC = 9:30 NY (EST)
    expect(nyHour(Date.parse('2024-01-15T14:30:00Z'))).toBe(9)
    // rollover de jour : 03:00 UTC = 23:00 NY la veille (EDT)
    expect(nyHour(Date.parse('2024-06-15T03:00:00Z'))).toBe(23)
  })

  it('nyDow rolls the weekday back across midnight', () => {
    // lundi 2024-01-01 00:30 UTC = dimanche 19:30 à NY
    expect(nyDow(Date.parse('2024-01-01T00:30:00Z'))).toBe(0)
    // lundi 2024-01-01 15:00 UTC = lundi 10:00 à NY
    expect(nyDow(Date.parse('2024-01-01T15:00:00Z'))).toBe(1)
  })
})
