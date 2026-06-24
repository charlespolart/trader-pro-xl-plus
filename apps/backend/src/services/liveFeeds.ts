import type { AggTrade, Candle, Interval, MarketType } from '@tpx/shared'
import { aggTradeStream, BinanceMarketWs, klineStream, mapWsAggTrade, mapWsKline } from '@tpx/data'

export type CandleListener = (candle: Candle, closed: boolean) => void
export type TradeListener = (trade: AggTrade) => void

interface RawKlineEvent {
  k: Parameters<typeof mapWsKline>[0]
}

class FeedSocket {
  private readonly ws: BinanceMarketWs
  private readonly candleSubs = new Map<string, Set<CandleListener>>()
  private readonly tradeSubs = new Map<string, Set<TradeListener>>()

  constructor(market: MarketType, testnet: boolean) {
    this.ws = new BinanceMarketWs(market, testnet, {
      onMessage: (stream, data) => this.route(stream, data),
    })
    this.ws.connect()
  }

  private route(stream: string, data: unknown): void {
    if (stream.includes('@kline')) {
      const subs = this.candleSubs.get(stream)
      if (!subs) return
      const { candle, closed } = mapWsKline((data as RawKlineEvent).k)
      for (const cb of subs) cb(candle, closed)
    } else if (stream.includes('@aggTrade')) {
      const subs = this.tradeSubs.get(stream)
      if (!subs) return
      const trade = mapWsAggTrade(data as Parameters<typeof mapWsAggTrade>[0])
      for (const cb of subs) cb(trade)
    }
  }

  subCandles(symbol: string, interval: Interval, cb: CandleListener): () => void {
    const stream = klineStream(symbol, interval)
    let set = this.candleSubs.get(stream)
    if (!set) {
      set = new Set()
      this.candleSubs.set(stream, set)
      this.ws.subscribe([stream])
    }
    set.add(cb)
    return () => {
      set.delete(cb)
      if (set.size === 0) {
        this.candleSubs.delete(stream)
        this.ws.unsubscribe([stream])
      }
    }
  }

  subTrades(symbol: string, cb: TradeListener): () => void {
    const stream = aggTradeStream(symbol)
    let set = this.tradeSubs.get(stream)
    if (!set) {
      set = new Set()
      this.tradeSubs.set(stream, set)
      this.ws.subscribe([stream])
    }
    set.add(cb)
    return () => {
      set.delete(cb)
      if (set.size === 0) {
        this.tradeSubs.delete(stream)
        this.ws.unsubscribe([stream])
      }
    }
  }
}

/**
 * Shared, ref-counted market data sockets — one combined websocket per
 * (market, testnet); bots and UI chart viewers piggyback on the same streams.
 */
export class LiveFeeds {
  private readonly sockets = new Map<string, FeedSocket>()

  private socket(market: MarketType, testnet: boolean): FeedSocket {
    const key = `${market}:${testnet}`
    let s = this.sockets.get(key)
    if (!s) {
      s = new FeedSocket(market, testnet)
      this.sockets.set(key, s)
    }
    return s
  }

  subCandles(market: MarketType, testnet: boolean, symbol: string, interval: Interval, cb: CandleListener): () => void {
    return this.socket(market, testnet).subCandles(symbol, interval, cb)
  }

  subTrades(market: MarketType, testnet: boolean, symbol: string, cb: TradeListener): () => void {
    return this.socket(market, testnet).subTrades(symbol, cb)
  }
}

export const liveFeeds = new LiveFeeds()
