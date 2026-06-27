import { describe, expect, it } from 'bun:test'
import { parseFill } from '../src/okx/fills'
import type { OkxOrderEvent } from '../src/okx/types'

describe('parseFill', () => {
  it('returns null when there is no fill on the event', () => {
    const ev: OkxOrderEvent = { instId: 'BTC-USDT-SWAP', clOrdId: 'tpxa1', ordId: '1', state: 'live', side: 'buy' }
    expect(parseFill(ev, 'futures', 0.01)).toBeNull()
  })

  it('converts contracts to base and flips the fee sign', () => {
    const ev: OkxOrderEvent = {
      instId: 'BTC-USDT-SWAP', clOrdId: 'tpxa1', ordId: '1', state: 'partially_filled', side: 'buy',
      fillSz: '5', fillPx: '50000', fillFee: '-0.025', fillFeeCcy: 'USDT', fillPnl: '0', fillTime: '1782637737000',
    }
    const d = parseFill(ev, 'futures', 0.01)
    expect(d).toEqual({ lastQty: 0.05, price: 50000, fee: 0.025, feeCcy: 'USDT', pnl: 0, time: 1782637737000, maker: false })
  })

  it('keeps spot fill size as-is (ctVal 1)', () => {
    const ev: OkxOrderEvent = {
      instId: 'BTC-USDT', clOrdId: 'tpxa1', ordId: '1', state: 'filled', side: 'sell',
      fillSz: '0.01', fillPx: '50000', fillFee: '-0.5', fillFeeCcy: 'USDT', fillPnl: '0', fillTime: '1782637737000',
    }
    const d = parseFill(ev, 'spot', 1)
    expect(d?.lastQty).toBeCloseTo(0.01, 10)
  })
})
