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
  accFillSz?: string
  avgPx?: string
}
