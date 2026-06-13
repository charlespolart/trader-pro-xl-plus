import type { MarketType } from './market'
import type { FeeConfig } from './fees'
import type { Fill } from './order'
import type { ParamValues } from './params'
import type { ChartAnnotation, LogEntry } from './annotations'

/**
 * 'candle'    — fills simulated from OHLC with an intrabar path assumption.
 * 'aggtrades' — every aggregate trade is replayed: exact trigger ordering,
 *               volume-aware partial fills on limits. Slower, far more precise.
 */
export type FillMode = 'candle' | 'aggtrades'

/**
 * Candle mode only. 'heuristic': O→L→H→C when close >= open, O→H→L→C otherwise.
 * 'pessimistic': within a candle, the worst outcome for us always happens first
 * (stops trigger before take-profits, etc.).
 */
export type IntrabarPath = 'heuristic' | 'pessimistic'

export interface BacktestConfig {
  strategyId: string
  params: ParamValues
  market: MarketType
  symbol: string
  /** ms epoch, inclusive */
  start: number
  /** ms epoch, exclusive */
  end: number
  /** initial capital — in quote currency by default, in BASE asset when denomination='base' */
  initialBalance: number
  /**
   * Comptabilité de la performance :
   *  - 'quote' (défaut) : tout mesuré en USDT (achète d'abord, vend ensuite).
   *  - 'base' : tout mesuré en actif de base (BTC) — on DÉTIENT du BTC au
   *    départ et le but est d'en accumuler. Vendre puis racheter moins cher
   *    fait monter la courbe d'équité (en BTC). Buy & hold = garder son BTC
   *    = 0 %. Spot uniquement.
   */
  denomination?: 'quote' | 'base'
  /** futures only; 1 on spot */
  leverage: number
  fees: FeeConfig
  /** e.g. 0.0005 = 5 bps applied against us on MARKET / triggered-market fills */
  slippagePct: number
  fillMode: FillMode
  intrabarPath: IntrabarPath
  /**
   * aggtrades mode: max share of printed volume at our limit price that our
   * order can absorb (0..1). Models queue position / liquidity.
   */
  limitFillRatio: number
  /** futures: apply historical funding every 8h */
  fundingEnabled: boolean
  /** futures: maintenance margin rate used for the liquidation approximation */
  maintenanceMarginRate: number
  /** candles fed to indicators before `start` (strategy callbacks suppressed) */
  warmupBars: number
  label?: string
}

export const DEFAULT_BACKTEST_VALUES = {
  initialBalance: 10_000,
  leverage: 1,
  slippagePct: 0.0005,
  fillMode: 'candle' as FillMode,
  intrabarPath: 'heuristic' as IntrabarPath,
  limitFillRatio: 0.25,
  fundingEnabled: true,
  maintenanceMarginRate: 0.005,
  warmupBars: 1000,
}

export type BacktestStatus =
  | 'pending'
  | 'fetching_data'
  | 'running'
  | 'done'
  | 'error'
  | 'canceled'

export type TradeDirection = 'long' | 'short'

/** A round-trip trade (position opened → closed), rebuilt from fills. */
export interface TradeRecord {
  id: string
  botId?: string
  backtestId?: string
  market: MarketType
  symbol: string
  direction: TradeDirection
  entryTime: number
  /** null while still open */
  exitTime: number | null
  avgEntryPrice: number
  avgExitPrice: number | null
  /** max absolute position size reached during the trade */
  qty: number
  /** net of fees and funding */
  realizedPnl: number
  /** pnl relative to entry notional (entry qty * entry price / leverage for futures margin) */
  realizedPnlPct: number
  fees: number
  funding: number
  entryReason?: string
  exitReason?: string
  /** Max Adverse Excursion: worst unrealized loss during the trade (quote) */
  mae: number
  /** Max Favorable Excursion: best unrealized gain during the trade (quote) */
  mfe: number
  fills: Fill[]
}

export interface EquityPoint {
  time: number
  equity: number
  /** drawdown from running peak, percent (>= 0) */
  drawdownPct: number
}

export interface BacktestMetrics {
  start: number
  end: number
  durationDays: number
  initialBalance: number
  finalEquity: number
  netProfit: number
  netProfitPct: number
  grossProfit: number
  grossLoss: number
  profitFactor: number | null
  totalTrades: number
  openTradesAtEnd: number
  winningTrades: number
  losingTrades: number
  winRate: number
  avgWin: number
  avgLoss: number
  /** average pnl per trade */
  expectancy: number
  payoffRatio: number | null
  maxDrawdown: number
  maxDrawdownPct: number
  maxDrawdownDurationMs: number
  /** annualized, from per-candle equity returns */
  sharpe: number | null
  sortino: number | null
  calmar: number | null
  annualizedReturnPct: number
  annualizedVolatilityPct: number | null
  totalFees: number
  totalFunding: number
  /** share of time with an open position, percent */
  exposurePct: number
  avgTradeDurationMs: number
  maxConsecutiveWins: number
  maxConsecutiveLosses: number
  /** holding the symbol over the same period, fees ignored */
  buyHoldReturnPct: number
}

/** One plotted indicator output series, ready for the chart. */
export interface IndicatorSeriesDTO {
  /** e.g. 'ema(200)' */
  indicatorId: string
  /** feed it was computed on */
  feedId: string
  output: string
  /** 'markers': non-zero points render as signed arrows on the candles */
  plot: 'overlay' | 'pane' | 'markers'
  /** pane grouping key — outputs of one indicator share a pane */
  paneId: string
  color?: string
  /** [time, value] pairs; time in ms */
  points: [number, number | null][]
}

export interface BacktestRun {
  id: string
  config: BacktestConfig
  status: BacktestStatus
  /** 0..1 */
  progress: number
  error?: string
  createdAt: number
  startedAt?: number
  finishedAt?: number
  metrics?: BacktestMetrics
}

export interface BacktestResultDetail {
  run: BacktestRun
  trades: TradeRecord[]
  /** downsampled for UI; full curve kept in the artifact file */
  equity: EquityPoint[]
  annotations: ChartAnnotation[]
  logs: LogEntry[]
  indicators: IndicatorSeriesDTO[]
}
