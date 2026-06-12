import type { Candle } from '@tpx/shared'

/**
 * Anything indexable by lookback: at(0) is the current (latest closed) value,
 * at(1) is one bar ago — Pine-style. Used by cross helpers.
 */
export interface SeriesLike {
  at(lookback: number): number | null
  readonly value: number | null
}

/**
 * Candle history for one feed. Lookback indexing: at(0) = latest closed candle.
 * Backtests keep full history; live feeds pass a cap (ring behavior, amortized).
 */
export class CandleSeries {
  private candles: Candle[] = []

  constructor(private readonly cap: number = Number.POSITIVE_INFINITY) {}

  push(c: Candle): void {
    this.candles.push(c)
    if (this.candles.length > this.cap + 256) {
      this.candles.splice(0, this.candles.length - this.cap)
    }
  }

  get size(): number {
    return this.candles.length
  }

  at(lookback = 0): Candle | null {
    const i = this.candles.length - 1 - lookback
    return i >= 0 && i < this.candles.length ? this.candles[i]! : null
  }

  get last(): Candle | null {
    return this.at(0)
  }

  open(lookback = 0): number | null {
    return this.at(lookback)?.open ?? null
  }
  high(lookback = 0): number | null {
    return this.at(lookback)?.high ?? null
  }
  low(lookback = 0): number | null {
    return this.at(lookback)?.low ?? null
  }
  close(lookback = 0): number | null {
    return this.at(lookback)?.close ?? null
  }
  volume(lookback = 0): number | null {
    return this.at(lookback)?.volume ?? null
  }

  /** SeriesLike view over closes, usable with crossover()/crossunder(). */
  get closes(): SeriesLike {
    const self = this
    return {
      at: (lb: number) => self.close(lb),
      get value() {
        return self.close(0)
      },
    }
  }

  /** Highest high over the last `period` candles (current included). */
  highestHigh(period: number): number | null {
    if (this.size < period) return null
    let h = -Infinity
    for (let i = 0; i < period; i++) h = Math.max(h, this.at(i)!.high)
    return h
  }

  /** Lowest low over the last `period` candles (current included). */
  lowestLow(period: number): number | null {
    if (this.size < period) return null
    let l = Infinity
    for (let i = 0; i < period; i++) l = Math.min(l, this.at(i)!.low)
    return l
  }

  toArray(): readonly Candle[] {
    return this.candles
  }
}
