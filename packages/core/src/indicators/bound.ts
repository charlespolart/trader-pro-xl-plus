import type { Candle, IndicatorSeriesDTO } from '@tpx/shared'
import type { IndicatorInstance, IndicatorSpec } from './types'
import type { SeriesLike } from '../series'

export interface PlotOptions {
  plot?: 'overlay' | 'pane' | 'markers' | 'none'
  /** one color (single-output) or a per-output map */
  color?: string | Record<string, string>
  title?: string
}

/**
 * An indicator instance bound to a feed: updates incrementally on each closed
 * candle and keeps the history needed for lookback access and chart export.
 *
 * Single-output handles (O = number) directly satisfy SeriesLike, so they can
 * be passed to crossover()/crossunder() as-is.
 */
export class BoundIndicator<O = number> {
  readonly spec: IndicatorSpec<O>
  readonly feedId: string
  readonly plot: 'overlay' | 'pane' | 'markers' | 'none'
  readonly title: string
  value: O | null = null

  private readonly inst: IndicatorInstance<O>
  private readonly single: boolean
  private readonly colors: Record<string, string>
  private times: number[] = []
  private hist: Record<string, (number | null)[]> = {}

  constructor(
    feedId: string,
    spec: IndicatorSpec<O>,
    opts: PlotOptions = {},
    private readonly cap: number = Number.POSITIVE_INFINITY,
  ) {
    this.feedId = feedId
    this.spec = spec
    this.inst = spec.create()
    this.single = spec.outputs.length === 1 && spec.outputs[0] === 'value'
    this.plot = opts.plot ?? spec.defaultPlot
    this.title = opts.title ?? spec.id
    const colorOpt = opts.color
    this.colors = {
      ...spec.defaultColors,
      ...(typeof colorOpt === 'string' ? { [spec.outputs[0]!]: colorOpt } : (colorOpt ?? {})),
    }
    for (const out of spec.outputs) this.hist[out] = []
  }

  update(time: number, candle: Candle): void {
    const v = this.inst.update(candle)
    this.value = v
    this.times.push(time)
    if (this.single) {
      this.hist['value']!.push(v as number | null)
    } else {
      for (const out of this.spec.outputs) {
        this.hist[out]!.push(v === null ? null : ((v as Record<string, number>)[out] ?? null))
      }
    }
    if (this.times.length > this.cap + 256) {
      const drop = this.times.length - this.cap
      this.times.splice(0, drop)
      for (const out of this.spec.outputs) this.hist[out]!.splice(0, drop)
    }
  }

  get ready(): boolean {
    return this.value !== null
  }

  get size(): number {
    return this.times.length
  }

  /** Lookback access: at(0) = current value, at(1) = previous bar's value. */
  at(lookback = 0): O | null {
    const i = this.times.length - 1 - lookback
    if (i < 0) return null
    if (this.single) return this.hist['value']![i] as O | null
    const o: Record<string, number> = {}
    for (const out of this.spec.outputs) {
      const v = this.hist[out]![i]
      if (v === null || v === undefined) return null
      o[out] = v
    }
    return o as O
  }

  /** SeriesLike view over one named output (e.g. macdHandle.out('hist')). */
  out(name?: string): SeriesLike {
    const key = name ?? this.spec.outputs[0]!
    const arr = this.hist[key]
    if (!arr) {
      throw new Error(`Indicator ${this.spec.id} has no output '${key}' (outputs: ${this.spec.outputs.join(', ')})`)
    }
    const times = this.times
    return {
      at(lookback: number): number | null {
        const i = times.length - 1 - lookback
        return i >= 0 ? (arr[i] ?? null) : null
      },
      get value(): number | null {
        return arr.length > 0 ? (arr[arr.length - 1] ?? null) : null
      },
    }
  }

  /** Export plotted series for the chart (empty when plot === 'none'). */
  toSeriesDTO(): IndicatorSeriesDTO[] {
    if (this.plot === 'none') return []
    const paneId = `${this.feedId}:${this.spec.id}`
    const hidden = this.spec.hiddenOutputs ?? []
    return this.spec.outputs
      .filter((output) => !hidden.includes(output))
      .map((output) => ({
      indicatorId: this.spec.id,
      feedId: this.feedId,
      output,
      plot: this.plot as 'overlay' | 'pane' | 'markers',
      paneId,
      color: this.colors[output],
      points: this.times.map((t, i) => [t, this.hist[output]![i] ?? null] as [number, number | null]),
    }))
  }
}
