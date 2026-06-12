/** Round down to the exchange step (e.g. qty to stepSize). Robust to FP noise. */
export function floorToStep(value: number, step: number): number {
  if (step <= 0) return value
  const n = Math.floor((value + step * 1e-9) / step)
  return roundFp(n * step)
}

/** Round to nearest step (e.g. price to tickSize). */
export function roundToStep(value: number, step: number): number {
  if (step <= 0) return value
  return roundFp(Math.round(value / step) * step)
}

/** Kill FP noise like 0.30000000000000004 without losing real precision. */
export function roundFp(value: number): number {
  return Number.parseFloat(value.toPrecision(12))
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

export function sum(xs: number[]): number {
  let s = 0
  for (const x of xs) s += x
  return s
}

export function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : sum(xs) / xs.length
}

export function stddev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  let s = 0
  for (const x of xs) s += (x - m) * (x - m)
  return Math.sqrt(s / (xs.length - 1))
}

export function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size))
  return out
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Largest-triangle downsampling would be overkill; uniform stride keeps extremes per bucket. */
export function downsample<T>(points: T[], maxPoints: number): T[] {
  if (points.length <= maxPoints) return points
  const stride = points.length / maxPoints
  const out: T[] = []
  for (let i = 0; i < maxPoints; i++) {
    out.push(points[Math.floor(i * stride)] as T)
  }
  const last = points[points.length - 1] as T
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

export function utcDayKey(time: number): string {
  return new Date(time).toISOString().slice(0, 10)
}
