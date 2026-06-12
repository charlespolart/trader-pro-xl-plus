export interface Candle {
  openTime: number
  open: number
  high: number
  low: number
  close: number
  /** base asset volume */
  volume: number
  /** quote asset volume */
  quoteVolume: number
  /** number of trades */
  trades: number
  /** taker buy base asset volume */
  takerBuyBase: number
  /** taker buy quote asset volume */
  takerBuyQuote: number
  /** inclusive close time (openTime + interval - 1ms) */
  closeTime: number
}

export interface AggTrade {
  /** aggregate trade id */
  id: number
  price: number
  qty: number
  time: number
  /** true => the buyer is the maker => aggressive seller (downtick pressure) */
  isBuyerMaker: boolean
}

/** A contiguous, downloaded time range of market data. */
export interface CoverageRange {
  start: number
  /** exclusive */
  end: number
}
