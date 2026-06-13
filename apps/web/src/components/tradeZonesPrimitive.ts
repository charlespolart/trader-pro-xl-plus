import type { IChartApi, ISeriesApi, ISeriesPrimitive, SeriesType, Time } from 'lightweight-charts'

export interface TradeZone {
  /** série Time (UTCTimestamp, secondes) */
  from: Time
  to: Time
  win: boolean
}

interface BitmapScope {
  context: CanvasRenderingContext2D
  bitmapSize: { width: number; height: number }
  horizontalPixelRatio: number
}
interface RenderTarget {
  useBitmapCoordinateSpace(cb: (scope: BitmapScope) => void): void
}

/**
 * Primitive de série : dessine, derrière les bougies, un bandeau translucide
 * par trade (vert = gagnant, rouge = perdant) couvrant la durée du trade
 * (entrée → sortie). Permet de visualiser tous les trades d'un coup d'œil.
 */
export class TradeZonesPrimitive implements ISeriesPrimitive<Time> {
  private zones: TradeZone[] = []
  private chart: IChartApi | null = null
  private requestUpdate?: () => void
  private readonly views: TradeZonesPaneView[]

  constructor() {
    this.views = [new TradeZonesPaneView(this)]
  }

  attached(param: { chart: IChartApi; series: ISeriesApi<SeriesType>; requestUpdate: () => void }): void {
    this.chart = param.chart
    this.requestUpdate = param.requestUpdate
  }
  detached(): void {
    this.chart = null
    this.requestUpdate = undefined
  }
  paneViews(): readonly TradeZonesPaneView[] {
    return this.views
  }
  updateAllViews(): void {
    /* le renderer lit les zones à chaud */
  }

  setZones(zones: TradeZone[]): void {
    this.zones = zones
    this.requestUpdate?.()
  }
  getZones(): TradeZone[] {
    return this.zones
  }
  getChart(): IChartApi | null {
    return this.chart
  }
}

class TradeZonesPaneView {
  constructor(private readonly primitive: TradeZonesPrimitive) {}
  zOrder(): 'bottom' {
    return 'bottom' // derrière les bougies
  }
  renderer(): TradeZonesRenderer {
    return new TradeZonesRenderer(this.primitive)
  }
}

class TradeZonesRenderer {
  constructor(private readonly primitive: TradeZonesPrimitive) {}
  draw(target: RenderTarget): void {
    const chart = this.primitive.getChart()
    const zones = this.primitive.getZones()
    if (!chart || zones.length === 0) return
    const timeScale = chart.timeScale()
    // timeToCoordinate renvoie le CENTRE d'une bougie ; on élargit d'une
    // demi-bougie de chaque côté pour couvrir entièrement les bougies d'entrée
    // et de sortie (un trade sur une seule bougie reste visible).
    const halfBar = timeScale.options().barSpacing / 2
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context
      const hr = scope.horizontalPixelRatio
      const h = scope.bitmapSize.height
      for (const z of zones) {
        const x1 = timeScale.timeToCoordinate(z.from)
        const x2 = timeScale.timeToCoordinate(z.to)
        if (x1 === null || x2 === null) continue
        const left = (Math.min(x1, x2) - halfBar) * hr
        const right = (Math.max(x1, x2) + halfBar) * hr
        const width = Math.max(1, right - left)
        ctx.fillStyle = z.win ? 'rgba(38,166,154,0.15)' : 'rgba(239,83,80,0.15)'
        ctx.fillRect(left, 0, width, h)
      }
    })
  }
}
