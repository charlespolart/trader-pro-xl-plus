export interface WalkForwardWindow {
  index: number
  /** in-sample (optimization) range */
  isStart: number
  isEnd: number
  /** out-of-sample (validation) range */
  oosStart: number
  oosEnd: number
}

export interface WalkForwardOptions {
  /** number of OOS segments */
  windows: number
  /** in-sample share of each window, e.g. 0.75 */
  isRatio: number
  /** anchored: in-sample always starts at the global start (expanding window) */
  anchored?: boolean
}

/**
 * Rolling (or anchored) walk-forward split. The OOS segments tile the tail of
 * [start, end) contiguously; each is optimized on the IS period that precedes
 * it. Combined OOS performance is the only number that matters.
 */
export function walkForwardWindows(start: number, end: number, opts: WalkForwardOptions): WalkForwardWindow[] {
  const { windows, isRatio } = opts
  if (windows < 1) throw new Error('walk-forward needs at least 1 window')
  if (isRatio <= 0 || isRatio >= 1) throw new Error('isRatio must be in (0, 1)')
  const span = end - start
  if (span <= 0) throw new Error('empty range')

  // isLen + windows * oosLen = span, with isLen = oosLen * isRatio / (1 - isRatio)
  const oosLen = Math.floor(span / (windows + isRatio / (1 - isRatio)))
  const isLen = span - windows * oosLen
  if (oosLen <= 0 || isLen <= 0) throw new Error('range too small for this walk-forward configuration')

  const out: WalkForwardWindow[] = []
  for (let i = 0; i < windows; i++) {
    const oosStart = start + isLen + i * oosLen
    out.push({
      index: i,
      isStart: opts.anchored ? start : oosStart - isLen,
      isEnd: oosStart,
      oosStart,
      oosEnd: i === windows - 1 ? end : oosStart + oosLen,
    })
  }
  return out
}
