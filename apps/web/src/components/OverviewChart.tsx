import { useEffect, useRef } from 'react'
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { Candle } from '@tpx/shared'
import { ViewportPrimitive } from './viewportPrimitive'

const ts = (ms: number): UTCTimestamp => Math.floor(ms / 1000) as UTCTimestamp

interface Props {
  /** bougies de la time-frame d'ensemble (ex. 1d) */
  candles: Candle[]
  /** fenêtre visible du graphe principal, en ms (ou null) */
  visibleRange: { from: number; to: number } | null
  /** clic sur la vue d'ensemble → recentre le graphe principal sur ce temps (ms) */
  onNavigate?: (centerMs: number) => void
  height?: number
}

/**
 * Graphe « vue d'ensemble » : une time-frame plus large, figée (ni scroll ni
 * zoom), qui sert de mini-carte. Un rectangle (ViewportPrimitive) y montre la
 * tranche actuellement affichée par le graphe principal. Cliquer recentre le
 * principal là où on a cliqué.
 */
export function OverviewChart({ candles, visibleRange, onNavigate, height = 120 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const primRef = useRef<ViewportPrimitive | null>(null)
  const navRef = useRef(onNavigate)
  navRef.current = onNavigate

  // ---- create / destroy
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#0b0e14' },
        textColor: '#6b7488',
      },
      grid: { vertLines: { color: '#0f1420' }, horzLines: { color: '#0f1420' } },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#232a3b' },
      // largeur d'échelle fixe = alignée avec le graphe principal (même valeur)
      rightPriceScale: { borderColor: '#232a3b', minimumWidth: 64 },
      crosshair: { mode: 0 },
      handleScroll: false,
      handleScale: false,
    })
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#2c7a72',
      downColor: '#a33f3d',
      wickUpColor: '#2c7a72',
      wickDownColor: '#a33f3d',
      borderVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    })
    const prim = new ViewportPrimitive()
    series.attachPrimitive(prim)

    chartRef.current = chart
    seriesRef.current = series
    primRef.current = prim

    // clic → recentrer le graphe principal
    const onClick = (param: { time?: Time }): void => {
      if (param.time === undefined) return
      navRef.current?.(Number(param.time) * 1000)
    }
    chart.subscribeClick(onClick)

    return () => {
      chart.unsubscribeClick(onClick)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      primRef.current = null
    }
  }, [])

  // ---- candles (toujours re-fit : la vue d'ensemble montre tout)
  useEffect(() => {
    const s = seriesRef.current
    if (!s) return
    s.setData(candles.map((c) => ({ time: ts(c.openTime), open: c.open, high: c.high, low: c.low, close: c.close })))
    if (candles.length > 0) chartRef.current?.timeScale().fitContent()
  }, [candles])

  // ---- rectangle de fenêtre (calé sur l'ouverture de bougie d'ensemble)
  useEffect(() => {
    const prim = primRef.current
    if (!prim) return
    if (!visibleRange || candles.length === 0) {
      prim.setRange(null, null)
      return
    }
    const openSecs = candles.map((c) => Math.floor(c.openTime / 1000))
    const snap = (ms: number): UTCTimestamp => {
      const sec = Math.floor(ms / 1000)
      let lo = 0
      let hi = openSecs.length - 1
      let best = openSecs[0]!
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (openSecs[mid]! <= sec) {
          best = openSecs[mid]!
          lo = mid + 1
        } else hi = mid - 1
      }
      return best as UTCTimestamp
    }
    prim.setRange(snap(visibleRange.from), snap(visibleRange.to))
  }, [visibleRange, candles])

  return <div ref={containerRef} style={{ height }} className="w-full" />
}
