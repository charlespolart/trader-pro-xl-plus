import { describe, expect, it } from 'bun:test'
import { OkxUserStreamRouter } from '../src/services/okxLiveAdapter'

describe('OkxUserStreamRouter', () => {
  it('routes an order event to the adapter whose prefix matches', () => {
    const seen: string[] = []
    const adapter = { clientIdPrefix: 'tpxbot123', handleOrderEvent: (ev: { clOrdId: string }) => seen.push(ev.clOrdId) }
    const router = new OkxUserStreamRouter(null as never, () => {})
    router.register(adapter as never)
    router.dispatch({ channel: 'orders', data: [{ instId: 'BTC-USDT-SWAP', clOrdId: 'tpxbot123x', ordId: '1', state: 'filled', side: 'buy' }] })
    expect(seen).toEqual(['tpxbot123x'])
  })
})
