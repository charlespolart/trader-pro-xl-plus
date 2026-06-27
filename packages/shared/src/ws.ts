import type { Candle } from './candle'
import type { Interval, MarketType } from './market'
import type { Fill, Order } from './order'
import type { BotRuntimeInfo } from './bot'
import type { BacktestStatus } from './backtest'
import type { ChartAnnotation, LogEntry } from './annotations'

/**
 * Topic naming:
 *   bots                          — all bot runtime updates
 *   bot:<id>                      — one bot's logs/annotations/fills
 *   candles:<market>:<sym>:<itv>  — live candle stream
 *   backtests                     — run lifecycle/progress
 *   downloads                     — data download job progress
 *   account                       — balances (incl. BNB), global risk state
 */
export type ClientCommand =
  | { t: 'subscribe'; topic: string }
  | { t: 'unsubscribe'; topic: string }
  | { t: 'ping' }

export type ServerEvent =
  | { t: 'pong' }
  | { t: 'hello'; serverTime: number }
  | { t: 'bot:update'; info: BotRuntimeInfo }
  | { t: 'bot:removed'; botId: string }
  | { t: 'bot:log'; botId: string; entry: LogEntry }
  | { t: 'bot:annotation'; botId: string; annotation: ChartAnnotation }
  | { t: 'bot:order'; botId: string; order: Order }
  | { t: 'bot:fill'; botId: string; fill: Fill }
  | { t: 'candle'; market: MarketType; symbol: string; interval: Interval; candle: Candle; closed: boolean }
  | { t: 'backtest:progress'; id: string; status: BacktestStatus; progress: number; error?: string }
  | { t: 'optimization:progress'; id: string; done: number; total: number; status: string }
  | { t: 'download:progress'; jobId: string; label: string; done: number; total: number; status: 'running' | 'done' | 'error'; error?: string }
