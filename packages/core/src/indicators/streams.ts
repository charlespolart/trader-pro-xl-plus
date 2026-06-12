/**
 * Incremental value-stream primitives used to compose indicators.
 * Each returns a stateful function: feed values in order, get the smoothed
 * value or null while warming up.
 */

export type Stream = (x: number) => number | null

export function smaStream(period: number): Stream {
  const buf = new Float64Array(period)
  let i = 0
  let count = 0
  let sum = 0
  return (x) => {
    if (count >= period) sum -= buf[i]!
    buf[i] = x
    sum += x
    i = (i + 1) % period
    if (count < period) count++
    return count >= period ? sum / period : null
  }
}

/** EMA seeded with the SMA of the first `period` values (TradingView/TA-Lib convention). */
export function emaStream(period: number): Stream {
  const alpha = 2 / (period + 1)
  let seedSum = 0
  let seedCount = 0
  let value: number | null = null
  return (x) => {
    if (value === null) {
      seedSum += x
      seedCount++
      if (seedCount < period) return null
      value = seedSum / period
      return value
    }
    value = alpha * x + (1 - alpha) * value
    return value
  }
}

/** Wilder smoothing (RMA), alpha = 1/period, SMA-seeded. Used by RSI/ATR/ADX. */
export function rmaStream(period: number): Stream {
  const alpha = 1 / period
  let seedSum = 0
  let seedCount = 0
  let value: number | null = null
  return (x) => {
    if (value === null) {
      seedSum += x
      seedCount++
      if (seedCount < period) return null
      value = seedSum / period
      return value
    }
    value = alpha * x + (1 - alpha) * value
    return value
  }
}

export function wmaStream(period: number): Stream {
  const buf = new Float64Array(period)
  const denom = (period * (period + 1)) / 2
  let i = 0
  let count = 0
  return (x) => {
    buf[i] = x
    i = (i + 1) % period
    if (count < period) count++
    if (count < period) return null
    // oldest value is at index i (just past the write cursor)
    let num = 0
    for (let k = 0; k < period; k++) {
      num += buf[(i + k) % period]! * (k + 1)
    }
    return num / denom
  }
}

/** Population standard deviation over a rolling window (Pine ta.stdev biased=true). */
export function stddevStream(period: number): Stream {
  const buf = new Float64Array(period)
  let i = 0
  let count = 0
  let sum = 0
  let sumSq = 0
  return (x) => {
    if (count >= period) {
      const old = buf[i]!
      sum -= old
      sumSq -= old * old
    }
    buf[i] = x
    sum += x
    sumSq += x * x
    i = (i + 1) % period
    if (count < period) count++
    if (count < period) return null
    const variance = Math.max(0, sumSq / period - (sum / period) * (sum / period))
    return Math.sqrt(variance)
  }
}

/** Rolling max via monotonic deque — O(1) amortized. */
export function highestStream(period: number): Stream {
  const idx: number[] = []
  const val: number[] = []
  let n = 0
  return (x) => {
    while (val.length > 0 && val[val.length - 1]! <= x) {
      val.pop()
      idx.pop()
    }
    val.push(x)
    idx.push(n)
    if (idx[0]! <= n - period) {
      idx.shift()
      val.shift()
    }
    n++
    return n >= period ? val[0]! : null
  }
}

/** Rolling min via monotonic deque — O(1) amortized. */
export function lowestStream(period: number): Stream {
  const idx: number[] = []
  const val: number[] = []
  let n = 0
  return (x) => {
    while (val.length > 0 && val[val.length - 1]! >= x) {
      val.pop()
      idx.pop()
    }
    val.push(x)
    idx.push(n)
    if (idx[0]! <= n - period) {
      idx.shift()
      val.shift()
    }
    n++
    return n >= period ? val[0]! : null
  }
}

/** Value n bars ago (returns null until n+1 values seen). */
export function lagStream(n: number): Stream {
  const buf = new Float64Array(n + 1)
  let i = 0
  let count = 0
  return (x) => {
    buf[i] = x
    i = (i + 1) % (n + 1)
    if (count <= n) {
      count++
      return count > n ? buf[i]! : null
    }
    return buf[i]!
  }
}
