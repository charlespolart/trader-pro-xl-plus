import {
  floorToStep,
  roundToStep,
  type AggTrade,
  type Candle,
  type ChartAnnotation,
  type Fill,
  type IndicatorSeriesDTO,
  type LogEntry,
  type LogLevel,
  type Order,
  type OrderRequest,
  type ParamValues,
} from '@tpx/shared'
import { CandleSeries } from '../series'
import { BoundIndicator, type PlotOptions } from '../indicators/bound'
import type { IndicatorSpec } from '../indicators/types'
import type {
  EngineMode,
  ExecutionAdapter,
  FeedView,
  OrderApi,
  ResolvedFeed,
  RiskApi,
  RuntimeSinks,
  StrategyContext,
  StrategyDefinition,
} from './types'

export interface RuntimeOptions {
  def: StrategyDefinition
  /** validated upstream with validateParams() */
  params: ParamValues
  mode: EngineMode
  exec: ExecutionAdapter
  sinks?: RuntimeSinks
  /** candle/indicator history cap; backtests default to Infinity */
  historyCap?: number
  /** keep annotations/logs in memory for result export (backtests) */
  keepArtifacts?: boolean
}

interface FeedState extends ResolvedFeed {
  series: CandleSeries
  indicators: BoundIndicator<unknown>[]
}

/**
 * Drives a strategy against an ExecutionAdapter. The backtest engine and the
 * live/paper engines both speak to strategies exclusively through this class,
 * which is what guarantees backtest/live behavioral parity.
 */
export class StrategyRuntime {
  readonly def: StrategyDefinition
  readonly params: ParamValues
  readonly mode: EngineMode
  readonly ctx: StrategyContext

  private readonly exec: ExecutionAdapter
  private readonly sinks: RuntimeSinks
  private readonly historyCap: number
  private readonly keepArtifacts: boolean
  private readonly feeds = new Map<string, FeedState>()
  private readonly allIndicators: BoundIndicator<unknown>[] = []
  private readonly annotations: ChartAnnotation[] = []
  private readonly logs: LogEntry[] = []
  private state: Record<string, unknown> = {}
  private locals: Record<string, unknown> = {}
  private initDone = false
  private haltedReason: string | null = null

  constructor(opts: RuntimeOptions) {
    this.def = opts.def
    this.params = opts.params
    this.mode = opts.mode
    this.exec = opts.exec
    this.sinks = opts.sinks ?? {}
    this.historyCap = opts.historyCap ?? (opts.mode === 'backtest' ? Number.POSITIVE_INFINITY : 2000)
    this.keepArtifacts = opts.keepArtifacts ?? opts.mode === 'backtest'

    const specs = opts.def.data(opts.params)
    for (const [id, spec] of Object.entries(specs)) {
      if (!spec.interval && !spec.trades) {
        throw new Error(`Feed '${id}': declare an interval and/or trades: true`)
      }
      this.feeds.set(id, {
        id,
        symbol: spec.symbol ?? opts.exec.symbol,
        interval: spec.interval ?? null,
        trades: spec.trades ?? false,
        series: new CandleSeries(this.historyCap),
        indicators: [],
      })
    }
    const main = this.feeds.get('main')
    if (!main || !main.interval) {
      throw new Error(`Strategy '${opts.def.name}': a 'main' candle feed is required`)
    }
    if (main.symbol !== opts.exec.symbol) {
      throw new Error(`The 'main' feed must be on the traded symbol (${opts.exec.symbol})`)
    }

    this.ctx = this.buildContext()
  }

  // ---------------------------------------------------------------- context

  private buildContext(): StrategyContext {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this
    const exec = this.exec

    const roundPrice = (price: number): number => {
      const si = exec.symbolInfo()
      return si ? roundToStep(price, si.tickSize) : price
    }
    const roundQty = (qty: number): number => {
      const si = exec.symbolInfo()
      return si ? floorToStep(qty, si.stepSize) : qty
    }

    const submit = (req: OrderRequest): Promise<Order> => {
      if (self.haltedReason !== null) {
        return Promise.reject(new Error(`Strategy halted (${self.haltedReason}); order rejected`))
      }
      const si = exec.symbolInfo()
      const normalized: OrderRequest = { ...req }
      if (exec.market === 'spot') normalized.reduceOnly = undefined
      if (normalized.price !== undefined) normalized.price = roundPrice(normalized.price)
      if (normalized.stopPrice !== undefined) normalized.stopPrice = roundPrice(normalized.stopPrice)
      if (normalized.qty !== undefined) {
        normalized.qty = roundQty(normalized.qty)
        if (normalized.qty <= 0) {
          throw new Error(`Order qty rounds to zero (stepSize ${si?.stepSize ?? '?'})`)
        }
        if (si && normalized.qty < si.minQty) {
          throw new Error(`Order qty ${normalized.qty} < minQty ${si.minQty}`)
        }
        const refPrice = normalized.price ?? normalized.stopPrice ?? exec.lastPrice()
        if (si && refPrice > 0 && normalized.qty * refPrice < si.minNotional) {
          throw new Error(
            `Order notional ${(normalized.qty * refPrice).toFixed(2)} < minNotional ${si.minNotional}`,
          )
        }
      }
      if (normalized.qty === undefined && normalized.quoteQty === undefined) {
        throw new Error('Order needs qty or quoteQty')
      }
      return exec.submit(normalized)
    }

    const order: OrderApi = {
      market: (req) =>
        submit({ side: req.side, type: 'MARKET', qty: req.qty, quoteQty: req.quoteQty, reduceOnly: req.reduceOnly, ocoGroup: req.ocoGroup, reason: req.reason, tag: req.tag }),
      limit: (req) =>
        submit({
          side: req.side,
          type: req.postOnly ? 'LIMIT_MAKER' : 'LIMIT',
          qty: req.qty,
          price: req.price,
          timeInForce: req.timeInForce ?? 'GTC',
          reduceOnly: req.reduceOnly,
          ocoGroup: req.ocoGroup,
          reason: req.reason,
          tag: req.tag,
        }),
      stopMarket: (req) =>
        submit({ side: req.side, type: 'STOP_MARKET', qty: req.qty, stopPrice: req.stopPrice, reduceOnly: req.reduceOnly, ocoGroup: req.ocoGroup, reason: req.reason, tag: req.tag }),
      stopLimit: (req) =>
        submit({ side: req.side, type: 'STOP_LIMIT', qty: req.qty, stopPrice: req.stopPrice, price: req.price, timeInForce: 'GTC', reduceOnly: req.reduceOnly, ocoGroup: req.ocoGroup, reason: req.reason, tag: req.tag }),
      takeProfitMarket: (req) =>
        submit({ side: req.side, type: 'TAKE_PROFIT_MARKET', qty: req.qty, stopPrice: req.stopPrice, reduceOnly: req.reduceOnly, ocoGroup: req.ocoGroup, reason: req.reason, tag: req.tag }),
      takeProfitLimit: (req) =>
        submit({ side: req.side, type: 'TAKE_PROFIT_LIMIT', qty: req.qty, stopPrice: req.stopPrice, price: req.price, timeInForce: 'GTC', reduceOnly: req.reduceOnly, ocoGroup: req.ocoGroup, reason: req.reason, tag: req.tag }),
      cancel: async (orderId) => {
        await exec.cancel(orderId)
      },
      cancelAll: async (tag) => {
        for (const o of [...exec.openOrders()]) {
          if (tag === undefined || o.tag === tag) await exec.cancel(o.id)
        }
      },
      get open() {
        return exec.openOrders()
      },
    }

    const risk: RiskApi = {
      sizeByRisk: ({ entry, stop, riskPct }) => {
        const perUnit = Math.abs(entry - stop)
        if (perUnit <= 0) throw new Error('sizeByRisk: entry and stop must differ')
        const riskQuote = (exec.equity() * riskPct) / 100
        return roundQty(riskQuote / perUnit)
      },
      sizeByEquityPct: (pct) => {
        const lev = exec.market === 'futures' ? exec.position().leverage : 1
        const price = exec.lastPrice()
        if (price <= 0) throw new Error('sizeByEquityPct: no price yet')
        return roundQty(((exec.equity() * pct) / 100) * lev / price)
      },
    }

    const pushLog = (level: LogLevel, message: string, data?: unknown): void => {
      const entry: LogEntry = { time: exec.now(), level, message, data }
      if (self.keepArtifacts) self.logs.push(entry)
      self.sinks.onLog?.(entry)
    }

    return {
      mode: this.mode,
      market: exec.market,
      symbol: exec.symbol,
      params: this.params,
      get time() {
        return exec.now()
      },
      get price() {
        return exec.lastPrice()
      },
      get candles() {
        return self.feeds.get('main')!.series
      },
      feed: (id: string): FeedView => {
        const f = self.feeds.get(id)
        if (!f) throw new Error(`Unknown feed '${id}' (declared: ${[...self.feeds.keys()].join(', ')})`)
        return { id: f.id, symbol: f.symbol, interval: f.interval, candles: f.series }
      },
      indicator: <O>(feedId: string, spec: IndicatorSpec<O>, opts?: PlotOptions): BoundIndicator<O> => {
        if (self.initDone) {
          throw new Error('ctx.indicator() is only allowed inside init() — register all indicators up front')
        }
        const f = self.feeds.get(feedId)
        if (!f) throw new Error(`Unknown feed '${feedId}'`)
        if (!f.interval) throw new Error(`Feed '${feedId}' has no candle interval; indicators need candles`)
        const bound = new BoundIndicator<O>(feedId, spec, opts, self.historyCap)
        f.indicators.push(bound as BoundIndicator<unknown>)
        self.allIndicators.push(bound as BoundIndicator<unknown>)
        return bound
      },
      get position() {
        return exec.position()
      },
      get balances() {
        return exec.balances()
      },
      get equity() {
        return exec.equity()
      },
      order,
      risk,
      get state() {
        return self.state
      },
      get locals() {
        return self.locals
      },
      get symbolInfo() {
        return exec.symbolInfo()
      },
      roundPrice,
      roundQty,
      annotate: (a: ChartAnnotation) => {
        if (self.keepArtifacts) self.annotations.push(a)
        self.sinks.onAnnotation?.(a)
      },
      log: (m, d) => pushLog('info', m, d),
      debug: (m, d) => pushLog('debug', m, d),
      warn: (m, d) => pushLog('warn', m, d),
      halt: (reason: string) => {
        self.haltedReason = reason
        self.sinks.onHalt?.(reason)
      },
    }
  }

  // ----------------------------------------------------------- engine hooks

  async init(): Promise<void> {
    const returned = await this.def.hooks.init?.(this.ctx as never)
    if (returned !== undefined && returned !== null && typeof returned === 'object') {
      this.locals = returned as Record<string, unknown>
    }
    this.initDone = true
  }

  /**
   * Feed one CLOSED candle. Series and indicators always update; strategy
   * callbacks are suppressed during warmup.
   */
  async handleCandle(feedId: string, candle: Candle, suppressHooks: boolean): Promise<void> {
    const f = this.feeds.get(feedId)
    if (!f) return
    f.series.push(candle)
    for (const indic of f.indicators) indic.update(candle.openTime, candle)
    if (!suppressHooks && this.haltedReason === null) {
      await this.def.hooks.onCandle?.(this.ctx, feedId, candle)
    }
  }

  async handleTrade(feedId: string, trade: AggTrade, suppressHooks: boolean): Promise<void> {
    if (suppressHooks || this.haltedReason !== null) return
    await this.def.hooks.onTrade?.(this.ctx, feedId, trade)
  }

  async handleFill(fill: Fill, order: Order): Promise<void> {
    await this.def.hooks.onFill?.(this.ctx, fill, order)
  }

  async handleOrderUpdate(order: Order): Promise<void> {
    await this.def.hooks.onOrderUpdate?.(this.ctx, order)
  }

  async handleFunding(amount: number, rate: number): Promise<void> {
    await this.def.hooks.onFunding?.(this.ctx, amount, rate)
  }

  async stop(): Promise<void> {
    await this.def.hooks.onStop?.(this.ctx)
  }

  // ------------------------------------------------------------- inspection

  get halted(): string | null {
    return this.haltedReason
  }

  /** resolved feed list, for engines to subscribe/load data */
  get feedList(): ResolvedFeed[] {
    return [...this.feeds.values()].map(({ id, symbol, interval, trades }) => ({ id, symbol, interval, trades }))
  }

  /** max indicator warmup (valid after init()) */
  maxWarmup(): number {
    let w = 0
    for (const i of this.allIndicators) w = Math.max(w, i.spec.warmup)
    return w
  }

  collectIndicatorSeries(): IndicatorSeriesDTO[] {
    return this.allIndicators.flatMap((i) => i.toSeriesDTO())
  }

  collectAnnotations(): ChartAnnotation[] {
    return this.annotations
  }

  collectLogs(): LogEntry[] {
    return this.logs
  }

  getState(): Record<string, unknown> {
    return this.state
  }

  /** restore persisted strategy state (live restart); ctx.state is a getter over this */
  loadState(state: Record<string, unknown>): void {
    this.state = state
  }
}
