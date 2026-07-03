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
        background: { type: ColorType.Solid, color: '#0b0d11' },
        textColor: '#9ca3af',
        panes: { separatorColor: '#242a36' },
      },
      grid: { vertLines: { color: '#12151d' }, horzLines: { color: '#12151d' } },
      timeScale: { timeVisible: true, borderColor: '#242a36' },
      rightPriceScale: { borderColor: '#242a36' },
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
    const equity = chart.addSeries(LineSeries, { color: '#ffb454', lineWidth: 2, priceLineVisible: false, title: 'Équité' }, 0)
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
