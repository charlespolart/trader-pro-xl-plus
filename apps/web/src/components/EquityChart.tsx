import { useEffect, useRef } from 'react'
import {
  AreaSeries,
  ColorType,
  createChart,
  LineSeries,
  type IChartApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { EquityPoint } from '@tpx/shared'

export function EquityChart({ points, height = 260 }: { points: EquityPoint[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#0b0e14' },
        textColor: '#9ca3af',
        panes: { separatorColor: '#232a3b' },
      },
      grid: { vertLines: { color: '#161b28' }, horzLines: { color: '#161b28' } },
      timeScale: { timeVisible: true, borderColor: '#232a3b' },
      rightPriceScale: { borderColor: '#232a3b' },
    })
    chartRef.current = chart
    return () => {
      chart.remove()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    // wipe panes by removing all series
    // (component only re-renders on new result loads, so full reset is fine)
    for (const pane of chart.panes()) {
      for (const s of pane.getSeries()) chart.removeSeries(s)
    }
    const equity = chart.addSeries(LineSeries, { color: '#3b82f6', lineWidth: 2, priceLineVisible: false, title: 'Équité' }, 0)
    equity.setData(points.map((p) => ({ time: Math.floor(p.time / 1000) as UTCTimestamp, value: p.equity })))
    const dd = chart.addSeries(
      AreaSeries,
      {
        lineColor: '#ef5350',
        topColor: 'rgba(239,83,80,0.05)',
        bottomColor: 'rgba(239,83,80,0.35)',
        lineWidth: 1,
        priceLineVisible: false,
        title: 'Drawdown %',
        invertFilledArea: true,
      },
      1,
    )
    dd.setData(points.map((p) => ({ time: Math.floor(p.time / 1000) as UTCTimestamp, value: -p.drawdownPct })))
    const panes = chart.panes()
    if (panes.length > 1) panes[1]!.setHeight(80)
    chart.timeScale().fitContent()
  }, [points])

  return <div ref={ref} style={{ height }} className="w-full" />
}
