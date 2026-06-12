import type { MarketType } from './market'

export interface FeeConfig {
  /** e.g. 0.001 = 0.10% */
  makerRate: number
  takerRate: number
  /** pay fees with BNB: -25% on spot, -10% on USDT-M futures */
  bnbDiscount: boolean
}

export const BNB_DISCOUNT: Record<MarketType, number> = {
  spot: 0.25,
  futures: 0.1,
}

/** Binance VIP0 defaults. */
export const DEFAULT_FEES: Record<MarketType, FeeConfig> = {
  spot: { makerRate: 0.001, takerRate: 0.001, bnbDiscount: true },
  futures: { makerRate: 0.0002, takerRate: 0.0005, bnbDiscount: false },
}

export function effectiveFeeRate(cfg: FeeConfig, market: MarketType, maker: boolean): number {
  const base = maker ? cfg.makerRate : cfg.takerRate
  return cfg.bnbDiscount ? base * (1 - BNB_DISCOUNT[market]) : base
}

export interface FundingEvent {
  symbol: string
  time: number
  /** signed rate; positive => longs pay shorts */
  rate: number
}
