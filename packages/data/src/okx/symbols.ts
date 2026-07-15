import { floorToStep, type MarketType } from '@tpx/shared'
import type { OkxInstType } from './types'

export function instType(market: MarketType): OkxInstType {
  return market === 'spot' ? 'SPOT' : 'SWAP'
}

export function toInstId(base: string, quote: string, market: MarketType): string {
  return market === 'spot' ? `${base}-${quote}` : `${base}-${quote}-SWAP`
}

/**
 * Execution quote currency for the configured OKX region. EU (EEA) accounts can't
 * trade USDT (MiCA delisted Tether in the EEA) — they execute on the USDC pair
 * instead, while market DATA stays on the original USDT Binance symbol (price
 * tracks 1:1). Other regions / other quotes pass through unchanged.
 *
 * S'applique AUSSI au démo (vérifié 2026-07-15 : ordre BTC-USDT démo rejeté
 * 51155 « local compliance restrictions » — les données USDT y sont répliquées
 * du réel mais le TRADING y est interdit ; et les carnets *-USDC du bac à
 * sable EEA sont morts + STP bloque l'auto-liquidité → un déclenchement de
 * trigger n'est PAS reproductible sur le démo EEA, cf. ops/incidents).
 */
export function execQuoteAsset(quoteAsset: string, _demo = false): string {
  if ((process.env.OKX_REGION ?? 'global').toLowerCase() === 'eea' && quoteAsset === 'USDT') return 'USDC'
  return quoteAsset
}

/** base coin quantity -> whole number of OKX contracts, floored to lotSz */
export function baseToContracts(baseQty: number, ctVal: number, lotSz: number): number {
  if (ctVal <= 0) return 0
  return floorToStep(baseQty / ctVal, lotSz)
}

export function contractsToBase(contracts: number, ctVal: number): number {
  return contracts * ctVal
}
