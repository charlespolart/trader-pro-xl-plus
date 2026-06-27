import { describe, expect, it } from 'bun:test'
import type { OrderRequest } from '@tpx/shared'
import {
  buildAlgoBody,
  buildOrderBody,
  clOrdPrefix,
  makeClOrdId,
  mapOkxState,
  mapOrdType,
} from '../src/okx/orders'

describe('okx orders', () => {
  it('builds an alphanumeric clOrdId <= 32 chars (no underscore)', () => {
    const prefix = clOrdPrefix('5708eef0-1234-5678')
    const id = makeClOrdId(prefix, 42)
    expect(id).toMatch(/^[a-z0-9]{1,32}$/i)
    expect(id.startsWith(prefix)).toBe(true)
  })

  it('routes stops to algo orders', () => {
    expect(mapOrdType('MARKET', 'spot')).toEqual({ algo: false, ordType: 'market' })
    expect(mapOrdType('LIMIT_MAKER', 'futures')).toEqual({ algo: false, ordType: 'post_only' })
    expect(mapOrdType('STOP_MARKET', 'futures')).toEqual({ algo: true, ordType: 'trigger' })
  })

  it('maps OKX state to TPX status', () => {
    expect(mapOkxState('live', 'STOP_MARKET', 0)).toBe('TRIGGER_PENDING')
    expect(mapOkxState('live', 'LIMIT', 0)).toBe('NEW')
    expect(mapOkxState('partially_filled', 'LIMIT', 1)).toBe('PARTIALLY_FILLED')
    expect(mapOkxState('filled', 'LIMIT', 1)).toBe('FILLED')
    expect(mapOkxState('canceled', 'LIMIT', 0)).toBe('CANCELED')
  })

  it('spot market buy sized in quote uses tgtCcy=quote_ccy', () => {
    const req: OrderRequest = { side: 'BUY', type: 'MARKET', quoteQty: 100 }
    const body = buildOrderBody({
      instId: 'BTC-USDT', market: 'spot', req, clOrdId: 'tpxabc1', ctVal: 1, lotSz: 0.0001, refPrice: 50000,
    })
    expect(body).toMatchObject({ instId: 'BTC-USDT', tdMode: 'cash', side: 'buy', ordType: 'market', sz: '100', tgtCcy: 'quote_ccy' })
  })

  it('futures market sells size in contracts and sets reduceOnly', () => {
    const req: OrderRequest = { side: 'SELL', type: 'MARKET', qty: 0.05, reduceOnly: true }
    const body = buildOrderBody({
      instId: 'BTC-USDT-SWAP', market: 'futures', req, clOrdId: 'tpxabc2', ctVal: 0.01, lotSz: 1, refPrice: 50000,
    })
    expect(body).toMatchObject({ instId: 'BTC-USDT-SWAP', tdMode: 'isolated', side: 'sell', ordType: 'market', sz: '5', reduceOnly: 'true' })
  })

  it('builds an algo body for stop-market with market trigger price', () => {
    const req: OrderRequest = { side: 'SELL', type: 'STOP_MARKET', qty: 0.05, stopPrice: 48000, reduceOnly: true }
    const body = buildAlgoBody({
      instId: 'BTC-USDT-SWAP', market: 'futures', req, clOrdId: 'tpxabc3', ctVal: 0.01, lotSz: 1, refPrice: 50000,
    })
    expect(body).toMatchObject({ ordType: 'trigger', triggerPx: '48000', orderPx: '-1', sz: '5', reduceOnly: 'true' })
  })
})
