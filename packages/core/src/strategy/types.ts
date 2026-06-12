import type {
  AggTrade,
  Balance,
  Candle,
  ChartAnnotation,
  Fill,
  Interval,
  LogEntry,
  MarketType,
  Order,
  OrderRequest,
  OrderSide,
  ParamSchema,
  ParamValues,
  Position,
  SymbolInfo,
  TimeInForce,
} from '@tpx/shared'
import type { CandleSeries } from '../series'
import type { IndicatorSpec } from '../indicators/types'
import type { BoundIndicator, PlotOptions } from '../indicators/bound'

export type EngineMode = 'backtest' | 'paper' | 'testnet' | 'live'

/** Declares one data subscription of a strategy. */
export interface FeedSpec {
  /** defaults to the bot's traded symbol */
  symbol?: string
  /** closed-candle interval; may be omitted for a trades-only feed */
  interval?: Interval
  /** stream aggTrades into onTrade for this feed */
  trades?: boolean
}

export type FeedSpecMap = Record<string, FeedSpec>

export interface ResolvedFeed {
  id: string
  symbol: string
  interval: Interval | null
  trades: boolean
}

export interface FeedView {
  readonly id: string
  readonly symbol: string
  readonly interval: Interval | null
  readonly candles: CandleSeries
}

interface OrderCommon {
  reduceOnly?: boolean
  ocoGroup?: string
  reason?: string
  tag?: string
}

export interface OrderApi {
  market(req: OrderCommon & { side: OrderSide; qty?: number; quoteQty?: number }): Promise<Order>
  limit(req: OrderCommon & { side: OrderSide; qty: number; price: number; postOnly?: boolean; timeInForce?: TimeInForce }): Promise<Order>
  stopMarket(req: OrderCommon & { side: OrderSide; qty: number; stopPrice: number }): Promise<Order>
  stopLimit(req: OrderCommon & { side: OrderSide; qty: number; stopPrice: number; price: number }): Promise<Order>
  takeProfitMarket(req: OrderCommon & { side: OrderSide; qty: number; stopPrice: number }): Promise<Order>
  takeProfitLimit(req: OrderCommon & { side: OrderSide; qty: number; stopPrice: number; price: number }): Promise<Order>
  cancel(orderId: string): Promise<void>
  /** cancel all open orders, optionally only those with a given tag */
  cancelAll(tag?: string): Promise<void>
  readonly open: readonly Order[]
}

export interface RiskApi {
  /**
   * Base qty such that getting stopped out at `stop` from `entry` loses
   * `riskPct`% of current bot equity. The classic R-based position size.
   */
  sizeByRisk(opts: { entry: number; stop: number; riskPct: number }): number
  /** Base qty whose notional equals pct% of equity (× leverage on futures). */
  sizeByEquityPct(pct: number): number
}

export interface StrategyContext<P = ParamValues, L = Record<string, unknown>> {
  readonly mode: EngineMode
  readonly market: MarketType
  readonly symbol: string
  readonly params: P
  /**
   * Per-instance storage returned by init() — indicator handles, cached
   * computations… Typed from init's return value. Not persisted (use
   * ctx.state for anything that must survive a restart).
   */
  readonly locals: L
  /** current engine time, ms */
  readonly time: number
  /** last known price of the traded symbol */
  readonly price: number
  /** shortcut for feed('main').candles */
  readonly candles: CandleSeries
  feed(id: string): FeedView
  /**
   * Bind an indicator to a feed. Only allowed inside init() so that history
   * and warmup are deterministic. The handle updates automatically on every
   * closed candle of that feed.
   */
  indicator<O>(feedId: string, spec: IndicatorSpec<O>, opts?: PlotOptions): BoundIndicator<O>
  readonly position: Position
  readonly balances: readonly Balance[]
  /** bot equity in quote currency (allocation + realized + unrealized pnl) */
  readonly equity: number
  readonly order: OrderApi
  readonly risk: RiskApi
  /** strategy-private persistent state (JSON-serializable values only) */
  readonly state: Record<string, unknown>
  readonly symbolInfo: SymbolInfo | null
  /** round a price to the symbol's tickSize */
  roundPrice(price: number): number
  /** round a qty down to the symbol's stepSize */
  roundQty(qty: number): number
  /** draw on the chart + record in the trade journal */
  annotate(a: ChartAnnotation): void
  log(message: string, data?: unknown): void
  debug(message: string, data?: unknown): void
  warn(message: string, data?: unknown): void
  /** stop this bot/backtest from inside the strategy */
  halt(reason: string): void
}

export interface StrategyHooks<P = ParamValues, L = Record<string, unknown>> {
  /**
   * Register indicators here and return the per-instance locals object
   * (indicator handles, etc.) — it becomes ctx.locals in every other hook.
   * Candle history is not available yet at this point.
   */
  init?(ctx: StrategyContext<P, Record<string, never>>): L | Promise<L>
  /** fired once per CLOSED candle, per candle feed, in chronological order */
  onCandle?(ctx: StrategyContext<P, L>, feedId: string, candle: Candle): void | Promise<void>
  /** fired per aggTrade on feeds declared with trades: true */
  onTrade?(ctx: StrategyContext<P, L>, feedId: string, trade: AggTrade): void | Promise<void>
  onFill?(ctx: StrategyContext<P, L>, fill: Fill, order: Order): void | Promise<void>
  onOrderUpdate?(ctx: StrategyContext<P, L>, order: Order): void | Promise<void>
  /** futures: funding applied to the open position (amount < 0 means we paid) */
  onFunding?(ctx: StrategyContext<P, L>, amount: number, rate: number): void | Promise<void>
  onStop?(ctx: StrategyContext<P, L>): void | Promise<void>
}

/** Runtime-erased strategy, as loaded from a strategies/*.ts file. */
export interface StrategyDefinition {
  name: string
  description?: string
  markets: MarketType[]
  schema: ParamSchema
  data: (params: ParamValues) => FeedSpecMap
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hooks: StrategyHooks<any, any>
}

/**
 * What an engine must provide for a strategy to run against it.
 * Implemented by the backtest SimExchange and by the live/paper adapters.
 */
export interface ExecutionAdapter {
  readonly market: MarketType
  readonly symbol: string
  now(): number
  lastPrice(): number
  submit(req: OrderRequest): Promise<Order>
  cancel(orderId: string): Promise<Order | null>
  openOrders(): readonly Order[]
  position(): Position
  balances(): readonly Balance[]
  equity(): number
  symbolInfo(): SymbolInfo | null
}

export interface RuntimeSinks {
  onAnnotation?(a: ChartAnnotation): void
  onLog?(entry: LogEntry): void
  onHalt?(reason: string): void
}
