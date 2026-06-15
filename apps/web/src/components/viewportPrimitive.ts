import type { IChartApi, ISeriesApi, ISeriesPrimitive, SeriesType, Time } from 'lightweight-charts'

interface BitmapScope {
  context: CanvasRenderingContext2D
  bitmapSize: { width: number; height: number }
  horizontalPixelRatio: number
}
interface RenderTarget {
  useBitmapCoordinateSpace(cb: (scope: BitmapScope) => void): void
}

/**
 * Primitive « navigateur » : sur le graphe de vue d'ensemble, assombrit tout
 * sauf la tranche [from, to] (la fenêtre visible du graphe principal) et trace
 * une bordure sur ses deux bords. from/to sont des Time DÉJÀ calés sur une
 * ouverture de bougie de la vue d'ensemble (sinon timeToCoordinate renvoie null).
 */
export class ViewportPrimitive implements ISeriesPrimitive<Time> {
  private from: Time | null = null
  private to: Time | null = null
  private chart: IChartApi | null = null
  private requestUpdate?: () => void
  private readonly views: ViewportPaneView[]

  constructor() {
    this.views = [new ViewportPaneView(this)]
  }

  attached(param: { chart: IChartApi; series: ISeriesApi<SeriesType>; requestUpdate: () => void }): void {
    this.chart = param.chart
    this.requestUpdate = param.requestUpdate
  }
  detached(): void {
    this.chart = null
    this.requestUpdate = undefined
  }
  paneViews(): readonly ViewportPaneView[] {
    return this.views
  }
  updateAllViews(): void {
    /* le renderer lit from/to à chaud */
  }

  setRange(from: Time | null, to: Time | null): void {
    this.from = from
    this.to = to
    this.requestUpdate?.()
  }
  getRange(): { from: Time | null; to: Time | null } {
    return { from: this.from, to: this.to }
  }
  getChart(): IChartApi | null {
    return this.chart
  }
}

class ViewportPaneView {
  constructor(private readonly primitive: ViewportPrimitive) {}
  zOrder(): 'top' {
    return 'top' // au-dessus des bougies (on les assombrit à l'extérieur)
  }
  renderer(): ViewportRenderer {
    return new ViewportRenderer(this.primitive)
  }
}

class ViewportRenderer {
  constructor(private readonly primitive: ViewportPrimitive) {}
  draw(target: RenderTarget): void {
    const chart = this.primitive.getChart()
    const { from, to } = this.primitive.getRange()
    if (!chart || from === null || to === null) return
    const timeScale = chart.timeScale()
    const xf = timeScale.timeToCoordinate(from)
    const xt = timeScale.timeToCoordinate(to)
    if (xf === null || xt === null) return
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context
      const hr = scope.horizontalPixelRatio
      const w = scope.bitmapSize.width
      const h = scope.bitmapSize.height
      const left = Math.min(xf, xt) * hr
      const right = Math.max(xf, xt) * hr
      // assombrit l'extérieur de la fenêtre
      ctx.fillStyle = 'rgba(7,10,16,0.60)'
      if (left > 0) ctx.fillRect(0, 0, left, h)
      if (right < w) ctx.fillRect(right, 0, w - right, h)
      // léger voile bleu sur la fenêtre + bordures
      ctx.fillStyle = 'rgba(59,130,246,0.10)'
      ctx.fillRect(left, 0, right - left, h)
      // bordures : on borne leur x à [0, w-bw] pour qu'elles restent ENTIÈREMENT
      // visibles, plaquées au bord, au lieu d'être coupées en deux quand la fenêtre
      // touche le début/la fin des données.
      const bw = Math.max(1, hr)
      ctx.fillStyle = 'rgba(96,165,250,0.95)'
      ctx.fillRect(Math.max(0, Math.min(left, w - bw)), 0, bw, h)
      ctx.fillRect(Math.max(0, Math.min(right - bw, w - bw)), 0, bw, h)
    })
  }
}
