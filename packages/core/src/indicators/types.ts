import type { Candle } from '@tpx/shared'

/**
 * An indicator is a pure incremental computation: one closed candle in, one
 * value (or null while warming up) out. The exact same instance semantics run
 * in backtests and live — there is no separate "vectorized" path that could
 * diverge or look ahead.
 */
export interface IndicatorInstance<O> {
  update(candle: Candle): O | null
}

export interface IndicatorSpec<O = number> {
  /** stable id including params, e.g. 'ema(200)' — used as chart series id */
  id: string
  /** output names; single-output indicators use ['value'] */
  outputs: readonly string[]
  /** candles needed before the indicator produces values (used for data preload) */
  warmup: number
  /** 'markers': non-zero outputs render as signed arrows on the candles */
  defaultPlot: 'overlay' | 'pane' | 'markers'
  /** per-output default colors for the chart */
  defaultColors?: Record<string, string>
  /** outputs accessible via at()/out() but never plotted (signals, flags…) */
  hiddenOutputs?: readonly string[]
  create(): IndicatorInstance<O>
}

export function defineIndicator<O = number>(opts: {
  id: string
  outputs?: readonly string[]
  warmup?: number
  defaultPlot?: 'overlay' | 'pane' | 'markers'
  defaultColors?: Record<string, string>
  hiddenOutputs?: readonly string[]
  /** returns the per-instance update function (closure holds the state) */
  create: () => (candle: Candle) => O | null
}): IndicatorSpec<O> {
  return {
    id: opts.id,
    outputs: opts.outputs ?? ['value'],
    warmup: opts.warmup ?? 1,
    defaultPlot: opts.defaultPlot ?? 'overlay',
    defaultColors: opts.defaultColors,
    hiddenOutputs: opts.hiddenOutputs,
    create: () => {
      const update = opts.create()
      return { update }
    },
  }
}

/** Price source selector, Pine-style. */
export type Source =
  | 'open'
  | 'high'
  | 'low'
  | 'close'
  | 'hl2'
  | 'hlc3'
  | 'ohlc4'
  | 'volume'
  | ((c: Candle) => number)

export function sourceFn(s: Source): (c: Candle) => number {
  if (typeof s === 'function') return s
  switch (s) {
    case 'open':
      return (c) => c.open
    case 'high':
      return (c) => c.high
    case 'low':
      return (c) => c.low
    case 'close':
      return (c) => c.close
    case 'hl2':
      return (c) => (c.high + c.low) / 2
    case 'hlc3':
      return (c) => (c.high + c.low + c.close) / 3
    case 'ohlc4':
      return (c) => (c.open + c.high + c.low + c.close) / 4
    case 'volume':
      return (c) => c.volume
  }
}

/** id suffix for non-default sources, so 'ema(20,hl2)' ≠ 'ema(20)' */
export function srcId(s: Source): string {
  if (typeof s === 'function') return ',fn'
  return s === 'close' ? '' : `,${s}`
}
