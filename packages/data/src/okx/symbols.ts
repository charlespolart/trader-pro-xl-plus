import { floorToStep, type MarketType } from '@tpx/shared'
import type { OkxInstType } from './types'

export function instType(market: MarketType): OkxInstType {
  return market === 'spot' ? 'SPOT' : 'SWAP'
}

export function toInstId(base: string, quote: string, market: MarketType): string {
  return market === 'spot' ? `${base}-${quote}` : `${base}-${quote}-SWAP`
}

/** base coin quantity -> whole number of OKX contracts, floored to lotSz */
export function baseToContracts(baseQty: number, ctVal: number, lotSz: number): number {
  if (ctVal <= 0) return 0
  return floorToStep(baseQty / ctVal, lotSz)
}

export function contractsToBase(contracts: number, ctVal: number): number {
  return contracts * ctVal
}
