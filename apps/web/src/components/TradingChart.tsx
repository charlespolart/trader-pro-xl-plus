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
import { TradeZonesPrimitive } from './tradeZonesPrimitive'

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
  /** bandeaux translucides par trade (vert=gagnant, rouge=perdant), temps en ms */
  tradeZones?: { from: number; to: number; win: boolean }[]
  /** ws topic (candles:market:symbol:interval) for live updates */
  liveTopic?: string
  /** when set/changed, the chart scrolls to center this time (ms) */
  focusTime?: number
  /** émet la fenêtre temporelle visible (ms) à chaque pan/zoom — pour la vue d'ensemble */
  onVisibleTimeRangeChange?: (range: { from: number; to: number } | null) => void
  /** quand fourni/changé, applique cette fenêtre visible (ms) — navigation depuis la vue d'ensemble */
  viewTimeRange?: { from: number; to: number } | null
  height?: number
  className?: string
}

export function TradingChart({ candles, indicators = [], markers = [], annotations = [], tradeZones = [], liveTopic, focusTime, onVisibleTimeRangeChange, viewTimeRange, height = 480, className = '' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const indSeriesRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map())
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const tradeZonesRef = useRef<TradeZonesPrimitive | null>(null)
  const priceLinesRef = useRef<IPriceLine[]>([])
  const fittedRef = useRef(false)
  // textes des marqueurs (raisons d'achat/vente) indexés par temps (s) — affichés
  // au survol seulement, pour ne pas surcharger la chart
  const markerTextsRef = useRef<Map<number, string[]>>(new Map())
  // callback de fenêtre visible gardé en ref (l'effet de création ne tourne qu'une fois)
  const onRangeRef = useRef(onVisibleTimeRangeChange)
  onRangeRef.current = onVisibleTimeRangeChange

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
      // largeur d'échelle fixe = alignée avec la vue d'ensemble (même valeur)
      rightPriceScale: { borderColor: '#232a3b', minimumWidth: 64 },
      crosshair: { mode: 0 },
    })
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
      borderVisible: false,
      priceLineVisible: false, // pas de ligne pointillée au dernier prix
    })
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
      color: '#2a3247',
      priceLineVisible: false,
      lastValueVisible: false,
    })
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } })

    chartRef.current = chart
    candleSeriesRef.current = candleSeries
    volumeSeriesRef.current = volumeSeries
    markersRef.current = createSeriesMarkers(candleSeries, [])
    const tradeZonesPrim = new TradeZonesPrimitive()
    candleSeries.attachPrimitive(tradeZonesPrim)
    tradeZonesRef.current = tradeZonesPrim
    fittedRef.current = false

    // infobulle des raisons d'achat/vente : affichée au survol d'une bougie
    // qui porte des marqueurs, sinon masquée (chart non surchargée)
    const onMove = (param: { time?: Time; point?: { x: number; y: number } }): void => {
      const tip = tooltipRef.current
      if (!tip) return
      const texts = param.time !== undefined ? markerTextsRef.current.get(param.time as number) : undefined
      if (!texts || texts.length === 0 || !param.point) {
        tip.style.display = 'none'
        return
      }
      tip.innerHTML = texts.map((t) => `<div>${t.replace(/</g, '&lt;')}</div>`).join('')
      tip.style.display = 'block'
      const el = containerRef.current
      const w = el?.clientWidth ?? 0
      const tw = tip.offsetWidth
      // garde l'infobulle dans le cadre, à droite du curseur par défaut
      let left = param.point.x + 14
      if (left + tw > w - 6) left = param.point.x - tw - 14
      tip.style.left = `${Math.max(6, left)}px`
      tip.style.top = `${Math.max(6, param.point.y + 12)}px`
    }
    chart.subscribeCrosshairMove(onMove)

    // émet la fenêtre visible (ms) → la vue d'ensemble dessine le rectangle
    const onRange = (range: { from: Time; to: Time } | null): void => {
      if (!range) {
        onRangeRef.current?.(null)
        return
      }
      onRangeRef.current?.({ from: Number(range.from) * 1000, to: Number(range.to) * 1000 })
    }
    chart.timeScale().subscribeVisibleTimeRangeChange(onRange)

    return () => {
      chart.unsubscribeCrosshairMove(onMove)
      chart.timeScale().unsubscribeVisibleTimeRangeChange(onRange)
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      volumeSeriesRef.current = null
      indSeriesRef.current = new Map()
      markersRef.current = null
      tradeZonesRef.current = null
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

  // indicator history can start long before the first loaded candle (warmup);
  // anything outside the candle window must NOT reach the chart — markers at
  // unknown times get glued to the nearest bar and end up on the wrong candle
  const candleWindow = useMemo(() => {
    if (candles.length === 0) return null
    return { from: candles[0]!.openTime, to: candles[candles.length - 1]!.openTime }
  }, [candles])

  // ---- pattern-style series (plot 'markers'): signed arrows on the candles
  const patternMarkers = useMemo<ChartMarker[]>(() => {
    if (!candleWindow) return []
    const out: ChartMarker[] = []
    for (const dto of indicators) {
      if (dto.plot !== 'markers') continue
      for (const [t, v] of dto.points) {
        if (v === null || v === 0) continue
        if (t < candleWindow.from || t > candleWindow.to) continue
        out.push({
          time: t,
          position: v > 0 ? 'belowBar' : 'aboveBar',
          shape: v > 0 ? 'arrowUp' : 'arrowDown',
          color: v > 0 ? 'rgba(38,166,154,0.7)' : 'rgba(239,83,80,0.7)',
          text: dto.output,
        })
      }
    }
    return out
  }, [indicators, candleWindow])

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
      if (dto.plot === 'markers') continue
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
          .filter(
            (p): p is [number, number] =>
              p[1] !== null && (!candleWindow || (p[0] >= candleWindow.from && p[0] <= candleWindow.to)),
          )
          .map(([t, v]) => ({ time: ts(t), value: v })),
      )
      indSeriesRef.current.set(`${dto.paneId}:${dto.output}`, series)
    }
    // keep secondary panes compact
    const panes = chart.panes()
    for (let i = 1; i < panes.length; i++) panes[i]!.setHeight(110)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indKey, indicators, candleWindow])

  // ---- markers + label annotations (texte affiché au survol, pas en permanent)
  useEffect(() => {
    const plugin = markersRef.current
    if (!plugin) return
    // les fills sont horodatés à la CLÔTURE de bougie, mais le curseur renvoie
    // l'OUVERTURE : on cale chaque marqueur sur l'ouverture de sa bougie pour
    // que l'infobulle (indexée par temps) corresponde au survol.
    const openSecs = candles.map((c) => Math.floor(c.openTime / 1000))
    const snap = (ms: number): UTCTimestamp => {
      if (openSecs.length === 0) return Math.floor(ms / 1000) as UTCTimestamp
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
    const texts = new Map<number, string[]>()
    const addText = (t: number, txt?: string): void => {
      if (!txt) return
      const arr = texts.get(t) ?? []
      arr.push(txt)
      texts.set(t, arr)
    }
    const all: SeriesMarker<Time>[] = [
      ...[...markers, ...patternMarkers].map((m) => {
        const t = snap(m.time)
        addText(t as number, m.text)
        return { time: t, position: m.position, shape: m.shape, color: m.color }
      }),
      ...annotations
        .filter((a) => a.type === 'marker')
        .map((a): SeriesMarker<Time> => {
          const t = snap(a.time)
          addText(t as number, a.text)
          return {
            time: t,
            position: a.position === 'above' ? 'aboveBar' : a.position === 'below' ? 'belowBar' : 'inBar',
            shape: a.shape,
            color: a.color ?? '#fdd835',
          }
        }),
      ...annotations
        .filter((a) => a.type === 'label')
        .map((a) => {
          const t = snap(a.time)
          addText(t as number, a.text)
          return { time: t, position: 'inBar' as const, shape: 'square' as const, color: a.color ?? '#fdd835' }
        }),
    ].sort((a, b) => (a.time as number) - (b.time as number))
    plugin.setMarkers(all)
    markerTextsRef.current = texts
  }, [markers, annotations, patternMarkers, candles])

  // ---- bandeaux de trade (vert/rouge) derrière les bougies
  useEffect(() => {
    const prim = tradeZonesRef.current
    if (!prim) return
    // les fills sont horodatés à la CLÔTURE de bougie ; la série indexe par
    // l'OUVERTURE. timeToCoordinate ne connaît que les temps présents dans la
    // série → on cale chaque borne sur l'ouverture de sa bougie (binary search),
    // sinon les coordonnées sont nulles et rien n'est dessiné.
    const openSecs = candles.map((c) => Math.floor(c.openTime / 1000))
    const snap = (ms: number): UTCTimestamp => {
      if (openSecs.length === 0) return Math.floor(ms / 1000) as UTCTimestamp
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
    // borne la fin à la dernière bougie chargée : un trade encore ouvert (ou
    // dont la sortie est hors fenêtre) court jusqu'au bord droit visible
    const lastOpen = candleWindow?.to
    prim.setZones(
      tradeZones
        .filter((z) => !candleWindow || z.from <= candleWindow.to)
        .map((z) => ({
          from: snap(z.from),
          to: snap(lastOpen !== undefined ? Math.min(z.to, lastOpen) : z.to),
          win: z.win,
        })),
    )
  }, [tradeZones, candleWindow, candles])

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

  // ---- navigation externe : applique la fenêtre demandée par la vue d'ensemble.
  // Pas de boucle : ceci ne se déclenche qu'au clic sur la vue d'ensemble (nouvel
  // objet), pas quand l'utilisateur panne directement le graphe principal.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !viewTimeRange) return
    try {
      chart.timeScale().setVisibleRange({ from: ts(viewTimeRange.from), to: ts(viewTimeRange.to) })
    } catch {
      /* fenêtre hors plage */
    }
  }, [viewTimeRange])

  // ---- focus navigation (pattern lab, trade inspection)
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || focusTime === undefined || candles.length < 2) return
    const itv = candles[1]!.openTime - candles[0]!.openTime
    try {
      chart.timeScale().setVisibleRange({ from: ts(focusTime - 45 * itv), to: ts(focusTime + 45 * itv) })
    } catch {
      /* focus outside data range */
    }
  }, [focusTime, candles])

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

  return (
    <div style={{ position: 'relative', height }} className={`w-full ${className}`}>
      <div ref={containerRef} style={{ height: '100%' }} />
      <div
        ref={tooltipRef}
        style={{
          position: 'absolute',
          display: 'none',
          pointerEvents: 'none',
          zIndex: 10,
          maxWidth: '320px',
          background: 'rgba(10,13,19,0.95)',
          border: '1px solid #2a3247',
          borderRadius: '8px',
          padding: '7px 10px',
          fontSize: '12px',
          lineHeight: '1.45',
          color: '#e4e7ee',
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        }}
      />
    </div>
  )
}
