import { describe, expect, it } from 'bun:test'
import { OkxRest } from '../src/okx/rest'
import { OkxAccount } from '../src/okx/account'

function spyRest(data: unknown[]) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify({ code: '0', msg: '', data }), { status: 200 })
  }) as unknown as typeof fetch
  return { rest: new OkxRest({ fetchImpl, credentials: { apiKey: 'k', secret: 's', passphrase: 'p' } }), calls }
}

describe('OkxAccount order writes', () => {
  it('POSTs a regular order and returns the ack', async () => {
    const { rest, calls } = spyRest([{ ordId: '99', clOrdId: 'tpxa1', sCode: '0', sMsg: '' }])
    const acc = new OkxAccount(rest)
    const ack = await acc.placeOrder({ instId: 'BTC-USDT', tdMode: 'cash', side: 'buy', ordType: 'market', sz: '100', clOrdId: 'tpxa1' })
    expect(ack).toMatchObject({ ordId: '99', clOrdId: 'tpxa1', sCode: '0' })
    expect(calls[0].url).toContain('/api/v5/trade/order')
    expect(calls[0].init.method).toBe('POST')
  })

  it('rejects when sCode is non-zero', async () => {
    const { rest } = spyRest([{ ordId: '', clOrdId: 'tpxa1', sCode: '51008', sMsg: 'insufficient balance' }])
    const acc = new OkxAccount(rest)
    await expect(
      acc.placeOrder({ instId: 'BTC-USDT', tdMode: 'cash', side: 'buy', ordType: 'market', sz: '100', clOrdId: 'tpxa1' }),
    ).rejects.toThrow(/51008/)
  })
})
