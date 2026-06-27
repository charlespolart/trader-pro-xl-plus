import { isTriggerOrder, type MarketType, type OrderRequest, type OrderStatus, type OrderType } from '@tpx/shared'
import { baseToContracts } from './symbols'

export function clOrdPrefix(botId: string): string {
  return 'tpx' + botId.replace(/[^a-z0-9]/gi, '').slice(0, 8)
}

export function makeClOrdId(prefix: string, seq: number): string {
  return (prefix + seq.toString(36)).slice(0, 32)
}

export function mapOrdType(type: OrderType, market: MarketType): { algo: boolean; ordType: string } {
  if (isTriggerOrder(type)) return { algo: true, ordType: 'trigger' }
  if (type === 'LIMIT_MAKER') return { algo: false, ordType: 'post_only' }
  if (type === 'MARKET') return { algo: false, ordType: 'market' }
  return { algo: false, ordType: 'limit' }
}

export function mapOkxState(state: string, type: OrderType, executedQty: number): OrderStatus {
  switch (state) {
    case 'live':
      return isTriggerOrder(type) && executedQty === 0 ? 'TRIGGER_PENDING' : 'NEW'
    case 'partially_filled':
      return 'PARTIALLY_FILLED'
    case 'filled':
      return 'FILLED'
    case 'canceled':
    case 'mmp_canceled':
      return 'CANCELED'
    case 'order_failed':
      return 'REJECTED'
    default:
      return 'NEW'
  }
}

function tdMode(market: MarketType): string {
  return market === 'spot' ? 'cash' : 'isolated'
}

/** size string in OKX units: contracts (SWAP) or base/quote coin (spot) */
function sizeFor(args: BuildArgs): { sz: string; tgtCcy?: string } {
  const { market, req, ctVal, lotSz, refPrice } = args
  if (market === 'futures') {
    const base = req.qty ?? (req.quoteQty && refPrice > 0 ? req.quoteQty / refPrice : 0)
    return { sz: String(baseToContracts(base, ctVal, lotSz)) }
  }
  // spot
  if (req.type === 'MARKET' && req.quoteQty !== undefined && req.qty === undefined) {
    return { sz: String(req.quoteQty), tgtCcy: 'quote_ccy' }
  }
  return { sz: String(req.qty ?? 0), tgtCcy: req.type === 'MARKET' ? 'base_ccy' : undefined }
}

export interface BuildArgs {
  instId: string
  market: MarketType
  req: OrderRequest
  clOrdId: string
  ctVal: number
  lotSz: number
  refPrice: number
}

export function buildOrderBody(args: BuildArgs): Record<string, unknown> {
  const { instId, market, req, clOrdId } = args
  const { ordType } = mapOrdType(req.type, market)
  const { sz, tgtCcy } = sizeFor(args)
  const body: Record<string, unknown> = {
    instId,
    tdMode: tdMode(market),
    side: req.side.toLowerCase(),
    ordType,
    sz,
    clOrdId,
  }
  if (req.price !== undefined) body.px = String(req.price)
  if (tgtCcy) body.tgtCcy = tgtCcy
  if (market === 'futures' && req.reduceOnly) body.reduceOnly = 'true'
  return body
}

export function buildAlgoBody(args: BuildArgs): Record<string, unknown> {
  const { instId, market, req, clOrdId } = args
  const { sz } = sizeFor(args)
  const isLimit = req.type === 'STOP_LIMIT' || req.type === 'TAKE_PROFIT_LIMIT'
  const body: Record<string, unknown> = {
    instId,
    tdMode: tdMode(market),
    side: req.side.toLowerCase(),
    ordType: 'trigger',
    sz,
    algoClOrdId: clOrdId,
    triggerPx: String(req.stopPrice ?? 0),
    orderPx: isLimit && req.price !== undefined ? String(req.price) : '-1',
    triggerPxType: 'last',
  }
  if (market === 'futures' && req.reduceOnly) body.reduceOnly = 'true'
  return body
}
