import {
  INTERVAL_MS,
  type AggTrade,
  type Candle,
  type FundingEvent,
  type Interval,
  type SymbolInfo,
} from '@tpx/shared'
import type { BinanceRest } from './rest'

/** REST kline tuple (times in ms) */
type RawKline = [
  number, // open time
  string, // open
  string, // high
  string, // low
  string, // close
  string, // volume
  number, // close time
  string, // quote volume
  number, // trades
  string, // taker buy base
  string, // taker buy quote
  string, // ignore
]

export function mapRestKline(k: RawKline): Candle {
  return {
    openTime: k[0],
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    closeTime: k[6],
    quoteVolume: Number(k[7]),
    trades: k[8],
    takerBuyBase: Number(k[9]),
    takerBuyQuote: Number(k[10]),
  }
}

interface RawAggTrade {
  a: number
  p: string
  q: string
  f: number
  l: number
  T: number
  m: boolean
}

interface RawFilter {
  filterType: string
  tickSize?: string
  stepSize?: string
  minQty?: string
  minNotional?: string
  notional?: string
}

interface RawSymbol {
  symbol: string
  status: string
  baseAsset: string
  quoteAsset: string
  baseAssetPrecision?: number
  quotePrecision?: number
  pricePrecision?: number
  quantityPrecision?: number
  filters: RawFilter[]
}

export class BinanceMarketData {
  constructor(private readonly rest: BinanceRest) {}

  /** one page, ascending */
  async klines(symbol: string, interval: Interval, start?: number, end?: number, limit = 1000): Promise<Candle[]> {
    const raw = await this.rest.public<RawKline[]>(this.rest.p('/klines'), {
      symbol,
      interval,
      startTime: start,
      endTime: end !== undefined ? end - 1 : undefined,
      limit,
    })
    return raw.map(mapRestKline)
  }

  /** full [start, end) range, paging through the API */
  async klinesRange(
    symbol: string,
    interval: Interval,
    start: number,
    end: number,
    onChunk?: (candles: Candle[]) => Promise<void> | void,
  ): Promise<Candle[]> {
    const out: Candle[] = []
    let cursor = start
    while (cursor < end) {
      const page = await this.klines(symbol, interval, cursor, end)
      if (page.length === 0) break
      if (onChunk) await onChunk(page)
      else out.push(...page)
      const last = page[page.length - 1]!
      const next = last.openTime + INTERVAL_MS[interval]
      if (next <= cursor) break
      cursor = next
      if (page.length < 950) break // reached the present
    }
    return out
  }

  async aggTrades(
    symbol: string,
    opts: { fromId?: number; startTime?: number; endTime?: number; limit?: number },
  ): Promise<AggTrade[]> {
    const raw = await this.rest.public<RawAggTrade[]>(this.rest.p('/aggTrades'), {
      symbol,
      fromId: opts.fromId,
      startTime: opts.startTime,
      endTime: opts.endTime,
      limit: opts.limit ?? 1000,
    })
    return raw.map((t) => ({
      id: t.a,
      price: Number(t.p),
      qty: Number(t.q),
      time: t.T,
      isBuyerMaker: t.m,
    }))
  }

  /** futures only — historical funding events in [start, end), paged */
  async fundingRateHistory(symbol: string, start: number, end: number): Promise<FundingEvent[]> {
    if (this.rest.market !== 'futures') throw new Error('funding rates are a futures concept')
    const out: FundingEvent[] = []
    let cursor = start
    while (cursor < end) {
      const page = await this.rest.public<{ symbol: string; fundingTime: number; fundingRate: string }[]>(
        '/fapi/v1/fundingRate',
        { symbol, startTime: cursor, endTime: end - 1, limit: 1000 },
      )
      if (page.length === 0) break
      for (const r of page) {
        out.push({ symbol: r.symbol, time: r.fundingTime, rate: Number(r.fundingRate) })
      }
      const next = page[page.length - 1]!.fundingTime + 1
      if (next <= cursor) break
      cursor = next
      if (page.length < 1000) break
    }
    return out
  }

  async price(symbol: string): Promise<number> {
    const r = await this.rest.public<{ price: string }>(this.rest.p('/ticker/price'), { symbol })
    return Number(r.price)
  }

  async symbolInfo(symbol: string): Promise<SymbolInfo | null> {
    const info = await this.rest.public<{ symbols: RawSymbol[] }>(this.rest.p('/exchangeInfo'), {
      symbol: this.rest.market === 'spot' ? symbol : undefined,
    })
    const s = info.symbols.find((x) => x.symbol === symbol)
    if (!s) return null
    return mapSymbolInfo(this.rest.market, s)
  }

  async allSymbols(): Promise<SymbolInfo[]> {
    const info = await this.rest.public<{ symbols: RawSymbol[] }>(this.rest.p('/exchangeInfo'))
    return info.symbols
      .filter((s) => s.status === 'TRADING')
      .map((s) => mapSymbolInfo(this.rest.market, s))
  }
}

function decimalsOf(step: number): number {
  if (step >= 1 || step <= 0) return 0
  return Math.max(0, Math.round(-Math.log10(step)))
}

function mapSymbolInfo(market: 'spot' | 'futures', s: RawSymbol): SymbolInfo {
  const find = (type: string) => s.filters.find((f) => f.filterType === type)
  const tickSize = Number(find('PRICE_FILTER')?.tickSize ?? '0.01')
  const lot = find('LOT_SIZE')
  const stepSize = Number(lot?.stepSize ?? '0.001')
  const minQty = Number(lot?.minQty ?? '0')
  const notionalFilter = find('NOTIONAL') ?? find('MIN_NOTIONAL')
  const minNotional = Number(notionalFilter?.minNotional ?? notionalFilter?.notional ?? '0')
  return {
    market,
    symbol: s.symbol,
    baseAsset: s.baseAsset,
    quoteAsset: s.quoteAsset,
    pricePrecision: s.pricePrecision ?? decimalsOf(tickSize),
    qtyPrecision: s.quantityPrecision ?? decimalsOf(stepSize),
    tickSize,
    stepSize,
    minQty,
    minNotional,
    status: s.status,
  }
}
