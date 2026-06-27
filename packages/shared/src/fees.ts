import type { MarketType } from './market'

export interface FeeConfig {
  /** e.g. 0.001 = 0.10% */
  makerRate: number
  takerRate: number
}

/** OKX "Regular" base tier (global fee framework, in force 2025-11-25). */
export const DEFAULT_FEES: Record<MarketType, FeeConfig> = {
  spot: { makerRate: 0.0008, takerRate: 0.001 },
  futures: { makerRate: 0.0002, takerRate: 0.0005 },
}

export interface FeeTierPreset {
  id: string
  label: string
  makerRate: number
  takerRate: number
}

/**
 * Published OKX schedule, indicative — actual rates vary by region/period and
 * are read live from /api/v5/account/trade-fee. Used to prefill backtest fees.
 */
export const FEE_TIER_PRESETS: Record<MarketType, FeeTierPreset[]> = {
  spot: [
    { id: 'regular', label: 'Regular', makerRate: 0.0008, takerRate: 0.001 },
    { id: 'vip1', label: 'VIP1', makerRate: 0.000675, takerRate: 0.0008 },
    { id: 'vip2', label: 'VIP2', makerRate: 0.0006, takerRate: 0.0007 },
    { id: 'vip3', label: 'VIP3', makerRate: 0.00055, takerRate: 0.00065 },
    { id: 'vip4', label: 'VIP4', makerRate: 0.0003, takerRate: 0.00045 },
    { id: 'vip5', label: 'VIP5', makerRate: 0.00025, takerRate: 0.00035 },
  ],
  futures: [
    { id: 'regular', label: 'Regular', makerRate: 0.0002, takerRate: 0.0005 },
    { id: 'vip1', label: 'VIP1', makerRate: 0.00018, takerRate: 0.0004 },
    { id: 'vip2', label: 'VIP2', makerRate: 0.00013, takerRate: 0.00035 },
    { id: 'vip3', label: 'VIP3', makerRate: 0.0001, takerRate: 0.00028 },
    { id: 'vip4', label: 'VIP4', makerRate: 0.00008, takerRate: 0.00027 },
    { id: 'vip5', label: 'VIP5', makerRate: 0.00005, takerRate: 0.00026 },
  ],
}

export function effectiveFeeRate(cfg: FeeConfig, maker: boolean): number {
  return maker ? cfg.makerRate : cfg.takerRate
}

export interface FundingEvent {
  symbol: string
  time: number
  /** signed rate; positive => longs pay shorts */
  rate: number
}
