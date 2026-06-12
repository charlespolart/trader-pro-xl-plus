import type { MarketType } from './market'

export type OrderSide = 'BUY' | 'SELL'

export type OrderType =
  | 'MARKET'
  | 'LIMIT'
  /** post-only limit (spot LIMIT_MAKER / futures GTX) */
  | 'LIMIT_MAKER'
  | 'STOP_MARKET'
  | 'STOP_LIMIT'
  | 'TAKE_PROFIT_MARKET'
  | 'TAKE_PROFIT_LIMIT'

export type TimeInForce = 'GTC' | 'IOC' | 'FOK'

export type OrderStatus =
  /** stop/TP order waiting for its trigger price */
  | 'TRIGGER_PENDING'
  | 'NEW'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELED'
  | 'REJECTED'
  | 'EXPIRED'

export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = [
  'TRIGGER_PENDING',
  'NEW',
  'PARTIALLY_FILLED',
]

export interface OrderRequest {
  side: OrderSide
  type: OrderType
  /** base asset quantity; for MARKET orders `quoteQty` may be used instead */
  qty?: number
  /** quote asset amount (MARKET orders only) — converted at fill time */
  quoteQty?: number
  /** limit price (LIMIT / STOP_LIMIT / TAKE_PROFIT_LIMIT / LIMIT_MAKER) */
  price?: number
  /** trigger price (STOP_* / TAKE_PROFIT_*) */
  stopPrice?: number
  timeInForce?: TimeInForce
  /** futures: never increases the position */
  reduceOnly?: boolean
  /**
   * Orders sharing a group are mutually exclusive: when one fills (or a
   * trigger order activates), the engine cancels its siblings. This is how
   * OCO / bracket exits are expressed, uniformly on spot and futures.
   */
  ocoGroup?: string
  /** free-text explanation recorded with the order, shown in UI/trade journal */
  reason?: string
  /** machine tag for the strategy's own bookkeeping (e.g. 'entry', 'sl', 'tp') */
  tag?: string
  clientId?: string
}

export interface Order {
  id: string
  clientId: string
  botId?: string
  market: MarketType
  symbol: string
  side: OrderSide
  type: OrderType
  status: OrderStatus
  qty: number
  executedQty: number
  /** cumulative quote spent/received on fills */
  cumQuote: number
  price?: number
  stopPrice?: number
  timeInForce: TimeInForce
  reduceOnly: boolean
  ocoGroup?: string
  reason?: string
  tag?: string
  /** exchange order id when live */
  exchangeOrderId?: string
  createdAt: number
  updatedAt: number
}

export interface Fill {
  id: string
  orderId: string
  botId?: string
  market: MarketType
  symbol: string
  side: OrderSide
  price: number
  qty: number
  quoteQty: number
  /** fee expressed in quote currency (normalized) */
  fee: number
  /** asset the fee was actually charged in (BNB, quote, base…) */
  feeAsset: string
  maker: boolean
  time: number
  /** tag inherited from the order ('entry', 'sl', 'tp'…) */
  tag?: string
  reason?: string
}

export function isOrderOpen(o: Order): boolean {
  return OPEN_ORDER_STATUSES.includes(o.status)
}

export function isTriggerOrder(t: OrderType): boolean {
  return t === 'STOP_MARKET' || t === 'STOP_LIMIT' || t === 'TAKE_PROFIT_MARKET' || t === 'TAKE_PROFIT_LIMIT'
}
