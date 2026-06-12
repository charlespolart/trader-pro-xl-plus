import type { MarketType } from '@tpx/shared'

export interface Endpoints {
  rest: string
  ws: string
}

export function endpointsFor(market: MarketType, testnet: boolean): Endpoints {
  if (market === 'spot') {
    return testnet
      ? { rest: 'https://testnet.binance.vision', ws: 'wss://stream.testnet.binance.vision' }
      : { rest: 'https://api.binance.com', ws: 'wss://stream.binance.com:9443' }
  }
  return testnet
    ? { rest: 'https://testnet.binancefuture.com', ws: 'wss://fstream.binancefuture.com' }
    : { rest: 'https://fapi.binance.com', ws: 'wss://fstream.binance.com' }
}

/** REST path prefix: spot /api/v3, futures /fapi/v1 */
export function apiPrefix(market: MarketType): string {
  return market === 'spot' ? '/api/v3' : '/fapi/v1'
}

export const VISION_BASE = 'https://data.binance.vision'

export function visionPrefix(market: MarketType): string {
  return market === 'spot' ? 'data/spot' : 'data/futures/um'
}
