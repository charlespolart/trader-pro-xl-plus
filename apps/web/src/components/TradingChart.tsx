import { useEffect, useMemo, useRef } from 'react'
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { Candle, ChartAnnotation, IndicatorSeriesDTO, ServerEvent, TradeRecord } from '@tpx/shared'
import { wsClient } from '../lib/ws'

const PALETTE = ['#2962ff', '#ff6d00', '#7e57c2', '#26a69a', '#ef5350', '#fdd835', '#29b6f6', '#ec407a']

const ts = (ms: number): UTCTimestamp => Math.floor(ms / 1000) as UTCTimestamp

export interface ChartMarker {
  time: number
  position: 'aboveBar' | 'belowBar' | 'inBar'
  shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square'
  color: string
  text?: string
}

/** entry/exit markers (with reasons) from round-trip trades */
export function tradesToMarkers(trades: TradeRecord[]): ChartMarker[] {
  const out: ChartMarker[] = []
  for (const t of trades) {
    const long = t.direction === 'long'
    out.push({
      time: t.entryTime,
      position: long ? 'belowBar' : 'aboveBar',
      shape: long ? 'arrowUp' : 'arrowDown',
      color: long ? '#26a69a' : '#ef5350',
      text: `${long ? 'LONG' : 'SHORT'} @${t.avgEntryPrice.toPrecision(6)}${t.entryReason ? ` — ${t.entryReason}` : ''}`,
    })
    if (t.exitTime !== null && t.avgExitPrice !== null) {
      out.push({
        time: t.exitTime,
        position: long ? 'aboveBar' : 'belowBar',
        shape: long ? 'arrowDown' : 'arrowUp',
        color: t.realizedPnl >= 0 ? '#26a69a' : '#ef5350',
        text: `EXIT @${t.avgExitPrice.toPrecision(6)} (${t.realizedPnl >= 0 ? '+' : ''}${t.realizedPnl.toFixed(2)})${t.exitReason ? ` — ${t.exitReason}` : ''}`,
      })
    }
  }
  return out
}

interface Props {
  candles: Candle[]
  indicators?: IndicatorSeriesDTO[]
  markers?: ChartMarker[]
  annotations?: ChartAnnotation[]
  /** ws topic (candles:market:symbol:interval) for live updates */
  liveTopic?: string
  height?: number
  className?: string
}

export function TradingChart({ candles, indicators = [], markers = [], annotations = [], liveTopic, height = 480, className = '' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const indSeriesRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map())
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const priceLinesRef = useRef<IPriceLine[]>([])
  const fittedRef = useRef(false)

  // ---- create / destroy
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#0b0e14' },
        textColor: '#9ca3af',
        panes: { separatorColor: '#232a3b' },
      },
      grid: {
        vertLines: { color: '#161b28' },
        horzLines: { color: '#161b28' },
      },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#232a3b' },
      rightPriceScale: { borderColor: '#232a3b' },
      crosshair: { mode: 0 },
    })
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
      borderVisible: false,
    })
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
      color: '#2a3247',
    })
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } })

    chartRef.current = chart
    candleSeriesRef.current = candleSeries
    volumeSeriesRef.current = volumeSeries
    markersRef.current = createSeriesMarkers(candleSeries, [])
    fittedRef.current = false

    return () => {
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      volumeSeriesRef.current = null
      indSeriesRef.current = new Map()
      markersRef.current = null
      priceLinesRef.current = []
    }
  }, [])

  // ---- candles + volume
  useEffect(() => {
    const cs = candleSeriesRef.current
    const vs = volumeSeriesRef.current
    if (!cs || !vs) return
    cs.setData(
      candles.map((c) => ({ time: ts(c.openTime), open: c.open, high: c.high, low: c.low, close: c.close })),
    )
    vs.setData(
      candles.map((c) => ({
        time: ts(c.openTime),
        value: c.volume,
        color: c.close >= c.open ? 'rgba(38,166,154,0.35)' : 'rgba(239,83,80,0.35)',
      })),
    )
    if (!fittedRef.current && candles.length > 0) {
      chartRef.current?.timeScale().fitContent()
      fittedRef.current = true
    }
  }, [candles])

  // ---- indicator series (recreate when the id set changes)
  const indKey = useMemo(() => indicators.map((s) => `${s.paneId}:${s.output}`).join('|'), [indicators])
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    for (const s of indSeriesRef.current.values()) chart.removeSeries(s)
    indSeriesRef.current = new Map()

    const paneIndex = new Map<string, number>()
    let nextPane = 1
    let colorIdx = 0
    for (const dto of indicators) {
      let pane = 0
      if (dto.plot === 'pane') {
        if (!paneIndex.has(dto.paneId)) paneIndex.set(dto.paneId, nextPane++)
        pane = paneIndex.get(dto.paneId)!
      }
      const series = chart.addSeries(
        LineSeries,
        {
          color: dto.color ?? PALETTE[colorIdx++ % PALETTE.length],
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: true,
          title: dto.output === 'value' ? dto.indicatorId : `${dto.indicatorId}.${dto.output}`,
        },
        pane,
      )
      series.setData(
        dto.points
          .filter((p): p is [number, number] => p[1] !== null)
          .map(([t, v]) => ({ time: ts(t), value: v })),
      )
      indSeriesRef.current.set(`${dto.paneId}:${dto.output}`, series)
    }
    // keep secondary panes compact
    const panes = chart.panes()
    for (let i = 1; i < panes.length; i++) panes[i]!.setHeight(110)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indKey, indicators])

  // ---- markers + label annotations
  useEffect(() => {
    const plugin = markersRef.current
    if (!plugin) return
    const all: SeriesMarker<Time>[] = [
      ...markers.map((m) => ({
        time: ts(m.time),
        position: m.position,
        shape: m.shape,
        color: m.color,
        text: m.text,
      })),
      ...annotations
        .filter((a) => a.type === 'marker')
        .map((a): SeriesMarker<Time> => ({
          time: ts(a.time),
          position: a.position === 'above' ? 'aboveBar' : a.position === 'below' ? 'belowBar' : 'inBar',
          shape: a.shape,
          color: a.color ?? '#fdd835',
          text: a.text,
        })),
      ...annotations
        .filter((a) => a.type === 'label')
        .map((a) => ({
          time: ts(a.time),
          position: 'inBar' as const,
          shape: 'square' as const,
          color: a.color ?? '#fdd835',
          text: a.text,
        })),
    ].sort((a, b) => (a.time as number) - (b.time as number))
    plugin.setMarkers(all)
  }, [markers, annotations])

  // ---- hline annotations as price lines
  useEffect(() => {
    const cs = candleSeriesRef.current
    if (!cs) return
    for (const pl of priceLinesRef.current) cs.removePriceLine(pl)
    priceLinesRef.current = []
    for (const a of annotations) {
      if (a.type !== 'hline') continue
      priceLinesRef.current.push(
        cs.createPriceLine({
          price: a.price,
          color: a.color ?? '#fdd835',
          lineWidth: 1,
          lineStyle: a.style === 'solid' ? LineStyle.Solid : a.style === 'dotted' ? LineStyle.Dotted : LineStyle.Dashed,
          axisLabelVisible: true,
          title: a.label ?? '',
        }),
      )
    }
  }, [annotations])

  // ---- live updates
  useEffect(() => {
    if (!liveTopic) return
    return wsClient.subscribe(liveTopic, (event: ServerEvent) => {
      if (event.t !== 'candle') return
      const c = event.candle
      candleSeriesRef.current?.update({ time: ts(c.openTime), open: c.open, high: c.high, low: c.low, close: c.close })
      volumeSeriesRef.current?.update({
        time: ts(c.openTime),
        value: c.volume,
        color: c.close >= c.open ? 'rgba(38,166,154,0.35)' : 'rgba(239,83,80,0.35)',
      })
    })
  }, [liveTopic])

  return <div ref={containerRef} style={{ height }} className={`w-full ${className}`} />
}
