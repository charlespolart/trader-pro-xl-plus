export type MarketType = 'spot' | 'futures'

export const MARKETS: readonly MarketType[] = ['spot', 'futures'] as const

/**
 * Supported kline intervals. '1s' is spot-only on Binance.
 * '1M' (calendar month) is intentionally excluded: its duration is not fixed,
 * which would poison every ms-based alignment in the engine.
 */
export const INTERVALS = [
  '1s', '1m', '3m', '5m', '15m', '30m',
  '1h', '2h', '4h', '6h', '8h', '12h',
  '1d', '3d', '1w',
] as const

export type Interval = (typeof INTERVALS)[number]

export const INTERVAL_MS: Record<Interval, number> = {
  '1s': 1_000,
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '2h': 7_200_000,
  '4h': 14_400_000,
  '6h': 21_600_000,
  '8h': 28_800_000,
  '12h': 43_200_000,
  '1d': 86_400_000,
  '3d': 259_200_000,
  '1w': 604_800_000,
}

export function isInterval(s: string): s is Interval {
  return (INTERVALS as readonly string[]).includes(s)
}

/** Epoch (1970-01-01) was a Thursday; Binance weekly candles open on Monday 00:00 UTC. */
const WEEK_OFFSET_MS = 4 * 86_400_000

/** Open time of the candle containing `time` for the given interval (Binance-aligned, UTC). */
export function alignOpenTime(time: number, interval: Interval): number {
  const ms = INTERVAL_MS[interval]
  if (interval === '1w') {
    return Math.floor((time - WEEK_OFFSET_MS) / ms) * ms + WEEK_OFFSET_MS
  }
  return Math.floor(time / ms) * ms
}

/** Close time (inclusive, Binance convention: openTime + interval - 1ms). */
export function closeTimeOf(openTime: number, interval: Interval): number {
  if (interval === '1w') return openTime + INTERVAL_MS['1w'] - 1
  return openTime + INTERVAL_MS[interval] - 1
}

/** Number of candles of `interval` fully contained in [start, end). */
export function candleCount(start: number, end: number, interval: Interval): number {
  return Math.max(0, Math.floor((end - start) / INTERVAL_MS[interval]))
}

export interface MarketRef {
  market: MarketType
  symbol: string
}

export function marketKey(market: MarketType, symbol: string, interval?: string): string {
  return interval ? `${market}:${symbol}:${interval}` : `${market}:${symbol}`
}

/** Symbol filters relevant to order placement, extracted from exchangeInfo. */
export interface SymbolInfo {
  market: MarketType
  symbol: string
  baseAsset: string
  quoteAsset: string
  pricePrecision: number
  qtyPrecision: number
  tickSize: number
  stepSize: number
  minQty: number
  minNotional: number
  /** futures only */
  maxLeverage?: number
  /** OKX SWAP contract value in base currency (ctVal); undefined/1 for spot */
  contractSize?: number
  status: string
}
