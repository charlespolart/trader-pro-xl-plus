import type { Balance, MarketType } from '@tpx/shared'
import type { OkxInstType } from '../okx/types'

export interface ExchangeInstrument {
  instId: string
  tickSize: number
  stepSize: number
  minQty: number
  /** contract value in base currency (SWAP); 1 for spot */
  contractSize: number
  maxLeverage: number
}

export interface ExchangePosition {
  instId: string
  /** signed base quantity (already converted from contracts) */
  qty: number
  entryPrice: number
  leverage: number
  liquidationPrice: number | null
  unrealizedPnl: number
}

export interface ExchangeOrderAck {
  exchangeOrderId: string
  clientId: string
}

export interface ExchangeAccountClient {
  balances(market: MarketType): Promise<Balance[]>
  positions(instId: string): Promise<ExchangePosition[]>
  tradeFee(instType: OkxInstType, instId: string): Promise<{ maker: number; taker: number; level: string } | null>
  setLeverage(instId: string, leverage: number, mgnMode: 'isolated' | 'cross'): Promise<void>
  instrument(instId: string): Promise<ExchangeInstrument>
}
