import type {
  AggTrade,
  BacktestConfig,
  BacktestMetrics,
  Candle,
  ChartAnnotation,
  EquityPoint,
  Fill,
  FundingEvent,
  IndicatorSeriesDTO,
  Interval,
  LogEntry,
  MarketType,
  SymbolInfo,
  TradeRecord,
} from '@tpx/shared'

/**
 * Data access used by the backtest engine. Implemented by @tpx/data on top of
 * Postgres + the binary aggTrades store, and by tests with in-memory fixtures.
 * Core stays storage-agnostic.
 */
export interface BacktestDataProvider {
  /** candles with openTime in [start, end), ascending */
  getCandles(market: MarketType, symbol: string, interval: Interval, start: number, end: number): Promise<Candle[]>
  /** aggTrades with time in [start, end), ascending, yielded in chunks */
  getAggTrades?(market: MarketType, symbol: string, start: number, end: number): AsyncIterable<AggTrade[]>
  /** historical funding events in [start, end), ascending (futures) */
  getFundingRates?(symbol: string, start: number, end: number): Promise<FundingEvent[]>
  getSymbolInfo(market: MarketType, symbol: string): Promise<SymbolInfo | null>
}

export interface BacktestProgress {
  /** 0..1 */
  ratio: number
  processedEvents: number
  currentTime: number
}

export interface BacktestEngineResult {
  config: BacktestConfig
  metrics: BacktestMetrics
  trades: TradeRecord[]
  equity: EquityPoint[]
  annotations: ChartAnnotation[]
  logs: LogEntry[]
  indicators: IndicatorSeriesDTO[]
  /** strategy ctx.state at the end of the run */
  finalState: Record<string, unknown>
  haltedReason: string | null
}

export interface SimEvents {
  onFill?(fill: Fill, orderId: string): void
  onOrderUpdate?(orderId: string): void
  onLiquidation?(price: number, time: number): void
}
