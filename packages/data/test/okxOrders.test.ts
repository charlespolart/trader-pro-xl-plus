import { describe, expect, it } from 'bun:test'
import type { OrderRequest } from '@tpx/shared'
import {
  buildAlgoBody,
  buildOrderBody,
  clOrdPrefix,
  fmtSz,
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

  it('clOrdId embeds a boot component: same seq across two boots never collides (P1-8)', () => {
    const prefix = clOrdPrefix('5708eef0-1234-5678')
    const boot1 = Date.parse('2026-07-03T10:00:00Z')
    const boot2 = boot1 + 15_000 // crash + redémarrage 15 s plus tard, seq perdu
    const a = makeClOrdId(prefix, 3, boot1)
    const b = makeClOrdId(prefix, 3, boot2)
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[a-z0-9]{1,32}$/i)
    expect(b.startsWith(prefix)).toBe(true)
    // ids d'un même boot : toujours uniques par seq
    expect(makeClOrdId(prefix, 4, boot1)).not.toBe(a)
  })

  it('fmtSz never emits exponential notation and floors to the step (P1-12)', () => {
    expect(fmtSz(1e-7, 1e-8)).toBe('0.0000001') // String(1e-7) === '1e-7' → rejeté par OKX
    expect(fmtSz(0.123456, 0.001)).toBe('0.123')
    expect(fmtSz(5, 1)).toBe('5')
    expect(fmtSz(100.999, 0.01)).toBe('100.99')
    expect(fmtSz(0.0500, 0.0001)).toBe('0.05')
    expect(fmtSz(0, 0.001)).toBe('0')
  })

  it('spot market sell qty is floored to the lot size', () => {
    const req: OrderRequest = { side: 'SELL', type: 'MARKET', qty: 0.12345678 }
    const body = buildOrderBody({
      instId: 'BTC-USDT', market: 'spot', req, clOrdId: 'tpxabc9', ctVal: 1, lotSz: 0.0001, refPrice: 50000,
    })
    expect(body.sz).toBe('0.1234')
    expect(body.tgtCcy).toBe('base_ccy')
  })

  it('spot market buy quoteQty is floored to the cent (and FP noise snaps to the intended value)', () => {
    const req: OrderRequest = { side: 'BUY', type: 'MARKET', quoteQty: 19999.994 }
    const body = buildOrderBody({
      instId: 'BTC-USDT', market: 'spot', req, clOrdId: 'tpxabc8', ctVal: 1, lotSz: 0.0001, refPrice: 50000,
    })
    expect(body.sz).toBe('19999.99')
    // un résidu FP d'un calcul qui visait 20000 est reconnu comme tel (floorToStep)
    const noisy = buildOrderBody({
      instId: 'BTC-USDT', market: 'spot', req: { ...req, quoteQty: 19999.999999999996 }, clOrdId: 'tpxabc8', ctVal: 1, lotSz: 0.0001, refPrice: 50000,
    })
    expect(noisy.sz).toBe('20000')
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
    expect(body.tgtCcy).toBeUndefined()
  })

  it('spot trigger-market BUY forces tgtCcy=base_ccy (OKX lit sz en quote par défaut — smoke 2026-07-03)', () => {
    const req: OrderRequest = { side: 'BUY', type: 'STOP_MARKET', qty: 0.0125, stopPrice: 60000 }
    const body = buildAlgoBody({
      instId: 'BTC-USDC', market: 'spot', req, clOrdId: 'tpxabc4', ctVal: 1, lotSz: 1e-8, refPrice: 58000,
    })
    expect(body).toMatchObject({ ordType: 'trigger', sz: '0.0125', tgtCcy: 'base_ccy', orderPx: '-1' })
    // trigger-LIMIT : sz est toujours en base côté OKX, tgtCcy ne s'applique pas
    const limit = buildAlgoBody({
      instId: 'BTC-USDC', market: 'spot', req: { ...req, type: 'STOP_LIMIT', price: 60100 }, clOrdId: 'tpxabc5', ctVal: 1, lotSz: 1e-8, refPrice: 58000,
    })
    expect(limit.tgtCcy).toBeUndefined()
    expect(limit.orderPx).toBe('60100')
  })
})
