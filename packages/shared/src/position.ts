import type { MarketType } from './market'

export interface Position {
  market: MarketType
  symbol: string
  /**
   * Signed base quantity. Long > 0, short < 0 (futures only — spot is >= 0).
   * Zero means flat.
   */
  qty: number
  /** average entry price of the open quantity (0 when flat) */
  entryPrice: number
  /** 1 on spot */
  leverage: number
  /** futures, isolated margin approximation; null when flat or spot */
  liquidationPrice: number | null
  unrealizedPnl: number
  updatedAt: number
}

export interface Balance {
  asset: string
  free: number
  locked: number
}

export function flatPosition(market: MarketType, symbol: string, leverage = 1): Position {
  return {
    market,
    symbol,
    qty: 0,
    entryPrice: 0,
    leverage,
    liquidationPrice: null,
    unrealizedPnl: 0,
    updatedAt: 0,
  }
}

export function positionSide(p: Position): 'long' | 'short' | 'flat' {
  if (p.qty > 0) return 'long'
  if (p.qty < 0) return 'short'
  return 'flat'
}

export function positionNotional(p: Position, markPrice: number): number {
  return Math.abs(p.qty) * markPrice
}
