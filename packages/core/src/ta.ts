import type { SeriesLike } from './series'

function pair(s: SeriesLike | number, lookback: number): number | null {
  return typeof s === 'number' ? s : s.at(lookback)
}

/** a crossed above b on the last closed bar. */
export function crossover(a: SeriesLike, b: SeriesLike | number): boolean {
  const a0 = a.at(0)
  const a1 = a.at(1)
  const b0 = pair(b, 0)
  const b1 = pair(b, 1)
  if (a0 === null || a1 === null || b0 === null || b1 === null) return false
  return a1 <= b1 && a0 > b0
}

/** a crossed below b on the last closed bar. */
export function crossunder(a: SeriesLike, b: SeriesLike | number): boolean {
  const a0 = a.at(0)
  const a1 = a.at(1)
  const b0 = pair(b, 0)
  const b1 = pair(b, 1)
  if (a0 === null || a1 === null || b0 === null || b1 === null) return false
  return a1 >= b1 && a0 < b0
}

/** strictly increasing over the last n bars. */
export function rising(s: SeriesLike, n = 1): boolean {
  for (let i = 0; i < n; i++) {
    const cur = s.at(i)
    const prev = s.at(i + 1)
    if (cur === null || prev === null || cur <= prev) return false
  }
  return true
}

/** strictly decreasing over the last n bars. */
export function falling(s: SeriesLike, n = 1): boolean {
  for (let i = 0; i < n; i++) {
    const cur = s.at(i)
    const prev = s.at(i + 1)
    if (cur === null || prev === null || cur >= prev) return false
  }
  return true
}
