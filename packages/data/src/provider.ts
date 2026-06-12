import type { BacktestDataProvider } from '@tpx/core'
import type { AggTrade, Candle, FundingEvent, Interval, MarketType, SymbolInfo } from '@tpx/shared'
import type { Db } from '@tpx/db'
import { BinanceRest } from './binance/rest'
import { BinanceMarketData } from './binance/market'
import { CandleStore } from './store/candleStore'
import { AggTradeStore } from './store/aggTradeStore'
import { FundingStore } from './store/fundingStore'

export interface ProviderOptions {
  dataDir: string
  /** download missing data on demand (default true) */
  autoEnsure?: boolean
  onProgress?: (label: string, done: number, total: number) => void
  signal?: AbortSignal
}

/**
 * BacktestDataProvider over the local stores: candles/funding from Postgres,
 * aggTrades from the binary day-files. Missing ranges download themselves on
 * first use (local-first policy).
 */
export class PgDataProvider implements BacktestDataProvider {
  readonly candles: CandleStore
  readonly aggTrades: AggTradeStore
  readonly funding: FundingStore
  private readonly mkt: Record<MarketType, BinanceMarketData>
  private readonly symbolInfoCache = new Map<string, SymbolInfo | null>()

  constructor(
    db: Db,
    private readonly opts: ProviderOptions,
  ) {
    this.candles = new CandleStore(db)
    this.aggTrades = new AggTradeStore(db, opts.dataDir)
    this.funding = new FundingStore(db)
    this.mkt = {
      spot: new BinanceMarketData(new BinanceRest({ market: 'spot' })),
      futures: new BinanceMarketData(new BinanceRest({ market: 'futures' })),
    }
  }

  async getCandles(
    market: MarketType,
    symbol: string,
    interval: Interval,
    start: number,
    end: number,
  ): Promise<Candle[]> {
    if (this.opts.autoEnsure ?? true) {
      await this.candles.ensureRange(market, symbol, interval, start, end, {
        signal: this.opts.signal,
        onProgress: (done, total) =>
          this.opts.onProgress?.(`candles ${symbol} ${interval}`, done, total),
      })
    }
    return this.candles.getCandles(market, symbol, interval, start, end)
  }

  getAggTrades(market: MarketType, symbol: string, start: number, end: number): AsyncIterable<AggTrade[]> {
    return this.aggTrades.iterate(market, symbol, start, end, {
      ensure: this.opts.autoEnsure ?? true,
      signal: this.opts.signal,
    })
  }

  async getFundingRates(symbol: string, start: number, end: number): Promise<FundingEvent[]> {
    if (this.opts.autoEnsure ?? true) {
      await this.funding.ensureRange(symbol, start, end)
    }
    return this.funding.get(symbol, start, end)
  }

  async getSymbolInfo(market: MarketType, symbol: string): Promise<SymbolInfo | null> {
    const key = `${market}:${symbol}`
    const cached = this.symbolInfoCache.get(key)
    if (cached !== undefined) return cached
    const info = await this.mkt[market].symbolInfo(symbol)
    this.symbolInfoCache.set(key, info)
    return info
  }
}
