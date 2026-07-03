export type OkxInstType = 'SPOT' | 'SWAP'

export interface OkxCredentials {
  apiKey: string
  secret: string
  passphrase: string
}

/** Standard OKX REST envelope. */
export interface OkxEnvelope<T> {
  code: string
  msg: string
  data: T[]
}

export interface OkxInstrumentRaw {
  instId: string
  instType: string
  tickSz: string
  lotSz: string
  minSz: string
  ctVal: string
  ctValCcy: string
  ctMult: string
  lever: string
  state: string
  baseCcy: string
  quoteCcy: string
}

export interface OkxOrderAck {
  ordId: string
  clOrdId: string
  algoId?: string
  algoClOrdId?: string
  sCode: string
  sMsg: string
}

/** A push from the private `orders` channel (one per fill or state change). */
export interface OkxOrderEvent {
  instId: string
  clOrdId: string
  ordId: string
  state: string // live | partially_filled | filled | canceled | mmp_canceled
  side: 'buy' | 'sell'
  fillSz?: string // last fill size, in contracts for SWAP
  fillPx?: string
  fillFee?: string // last fill fee, signed (negative = charged)
  fillFeeCcy?: string
  fillPnl?: string
  fillTime?: string
  /** OKX trade id of the last fill — unique per instrument, THE dedup key */
  tradeId?: string
  /** T = taker, M = maker (per fill) */
  execType?: string
  accFillSz?: string
  avgPx?: string
}

/** A normalized push from a private channel (orders / orders-algo / positions). */
export interface OkxPrivateEvent {
  channel: string
  data: OkxOrderEvent[]
}

/** An order returned by the orders-pending / orders-algo-pending / order /
 *  order-algo REST endpoints (superset of the shared fields). */
export interface OkxRestOrder {
  instId: string
  ordId?: string
  algoId?: string
  clOrdId?: string
  algoClOrdId?: string
  ordType: string
  side: 'buy' | 'sell'
  sz: string
  px?: string
  triggerPx?: string
  /** orders: live|partially_filled|filled|canceled — algos: live|effective|canceled|order_failed */
  state: string
  accFillSz?: string
  avgPx?: string
  /** cumulative fee, signed (negative = charged) — GET /trade/order */
  fee?: string
  feeCcy?: string
  /** cumulative realized pnl — GET /trade/order (futures) */
  pnl?: string
  /** executed size/price of a TRIGGERED algo — GET /trade/order-algo, state 'effective' */
  actualSz?: string
  actualPx?: string
}
