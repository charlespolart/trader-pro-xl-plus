import { floorToStep, isTriggerOrder, type MarketType, type OrderRequest, type OrderStatus, type OrderType } from '@tpx/shared'
import { baseToContracts } from './symbols'

export function clOrdPrefix(botId: string): string {
  return 'tpx' + botId.replace(/[^a-z0-9]/gi, '').slice(0, 8)
}

/**
 * clOrdId ≤ 32 alnum : prefix (11) + horodatage de boot en base36 (8) + seq (1-3).
 * Le composant temporel rend l'id unique MÊME après un crash qui perd le seq
 * snapshoté (15 s) — sans lui, un redémarrage réutilisait des clOrdId récents
 * (rejet 51016 ou écrasement d'un ancien ordre en DB).
 */
export function makeClOrdId(prefix: string, seq: number, bootMs?: number): string {
  const boot = bootMs !== undefined ? bootMs.toString(36) : ''
  return (prefix + boot + seq.toString(36)).slice(0, 32)
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
    case 'pause':
      return isTriggerOrder(type) && executedQty === 0 ? 'TRIGGER_PENDING' : 'NEW'
    case 'partially_filled':
    case 'partially_effective': // algo partiellement déclenché
      return 'PARTIALLY_FILLED'
    case 'filled':
    case 'effective': // algo déclenché ET exécuté (actualSz/actualPx)
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

/** Décimales du pas (gère la notation e-8 de String(1e-8)). */
function decimalsOf(step: number): number {
  const s = String(step)
  const m = /e-(\d+)$/i.exec(s)
  if (m) {
    const mant = s.slice(0, s.toLowerCase().indexOf('e'))
    const md = mant.includes('.') ? mant.split('.')[1]!.length : 0
    return Number(m[1]) + md
  }
  return s.includes('.') ? s.split('.')[1]!.length : 0
}

/**
 * Nombre → chaîne `sz` pour OKX : TOUJOURS en décimal fixe (String(1e-7) donne
 * '1e-7', rejeté par l'API), floored au pas de l'instrument. Un sz invalide sur
 * un ordre de fermeture d'urgence = fermeture qui échoue en silence.
 */
export function fmtSz(x: number, step: number): string {
  const v = floorToStep(x, step)
  if (!Number.isFinite(v) || v <= 0) return '0'
  const s = v.toFixed(Math.min(step > 0 ? decimalsOf(step) : 8, 20))
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

/** size string in OKX units: contracts (SWAP) or base/quote coin (spot) */
function sizeFor(args: BuildArgs): { sz: string; tgtCcy?: string } {
  const { market, req, ctVal, lotSz, refPrice } = args
  if (market === 'futures') {
    const base = req.qty ?? (req.quoteQty && refPrice > 0 ? req.quoteQty / refPrice : 0)
    return { sz: fmtSz(baseToContracts(base, ctVal, lotSz), lotSz) }
  }
  // spot — lotSz est ici le pas en unités base (ctVal = 1)
  if (req.type === 'MARKET' && req.quoteQty !== undefined && req.qty === undefined) {
    return { sz: fmtSz(req.quoteQty, 0.01), tgtCcy: 'quote_ccy' }
  }
  return { sz: fmtSz(req.qty ?? 0, lotSz), tgtCcy: req.type === 'MARKET' ? 'base_ccy' : undefined }
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
