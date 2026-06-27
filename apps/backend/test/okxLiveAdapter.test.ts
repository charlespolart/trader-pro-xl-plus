import { describe, expect, it } from 'bun:test'
import type { SymbolInfo } from '@tpx/shared'
import { OKXLiveAdapter } from '../src/services/okxLiveAdapter'

const SI: SymbolInfo = {
  market: 'futures', symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT',
  pricePrecision: 1, qtyPrecision: 3, tickSize: 0.1, stepSize: 0.001, minQty: 0.001,
  minNotional: 5, status: 'TRADING', contractSize: 0.01,
}

function fakeAccount(captured: Record<string, unknown>[]) {
  return {
    placeOrder: async (body: Record<string, unknown>) => { captured.push(body); return { ordId: 'o1', clOrdId: String(body.clOrdId), sCode: '0', sMsg: '' } },
    placeAlgoOrder: async (body: Record<string, unknown>) => { captured.push(body); return { ordId: '', algoId: 'a1', clOrdId: '', algoClOrdId: String(body.algoClOrdId), sCode: '0', sMsg: '' } },
    cancelOrder: async () => {}, cancelAlgoOrder: async () => {},
    openOrders: async () => [], openAlgoOrders: async () => [],
    positions: async () => [], instrument: async () => ({ instId: 'BTC-USDT-SWAP', tickSize: 0.1, stepSize: 1, minQty: 1, contractSize: 0.01, maxLeverage: 125 }),
  } as unknown as import('@tpx/data').OkxAccount
}

function mkAdapter(captured: Record<string, unknown>[]) {
  const fills: unknown[] = []
  const adapter = new OKXLiveAdapter({
    market: 'futures', demo: true, symbol: 'BTCUSDT', symbolInfo: SI, botId: 'bot-123',
    allocation: 1000, leverage: 10, account: fakeAccount(captured),
    events: { onFill: (f) => fills.push(f), onOrderUpdate: () => {} },
    getBalances: () => [],
  })
  adapter.setLastPrice(50000)
  return { adapter, fills }
}

describe('OKXLiveAdapter', () => {
  it('submits a futures market order sized in contracts with an alphanumeric clOrdId', async () => {
    const captured: Record<string, unknown>[] = []
    const { adapter } = mkAdapter(captured)
    const order = await adapter.submit({ side: 'BUY', type: 'MARKET', qty: 0.05 })
    expect(captured[0]).toMatchObject({ instId: 'BTC-USDT-SWAP', ordType: 'market', sz: '5' })
    expect(order.clientId).toMatch(/^tpx[a-z0-9]+$/i)
    expect(order.status).toBe('NEW')
  })

  it('applies a fill from a private order event and emits a normalized fill', async () => {
    const captured: Record<string, unknown>[] = []
    const { adapter, fills } = mkAdapter(captured)
    const order = await adapter.submit({ side: 'BUY', type: 'MARKET', qty: 0.05 })
    adapter.handleOrderEvent({
      instId: 'BTC-USDT-SWAP', clOrdId: order.clientId, ordId: 'o1', state: 'filled', side: 'buy',
      fillSz: '5', fillPx: '50000', fillFee: '-0.025', fillFeeCcy: 'USDT', fillPnl: '0', fillTime: '1782637737000', accFillSz: '5',
    })
    await Promise.resolve() // fee normalization is async
    expect(fills.length).toBe(1)
    expect(adapter.position().qty).toBeCloseTo(0.05, 6)
  })
})
