import { describe, expect, it } from 'bun:test'
import { OkxApiError, OkxRest } from '../src/okx/rest'
import { OkxAccount } from '../src/okx/account'

function spyRest(data: unknown[]) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify({ code: '0', msg: '', data }), { status: 200 })
  }) as unknown as typeof fetch
  return { rest: new OkxRest({ fetchImpl, credentials: { apiKey: 'k', secret: 's', passphrase: 'p' } }), calls }
}

function errorRest(code: string, msg: string) {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ code, msg, data: [] }), { status: 200 })) as unknown as typeof fetch
  return new OkxRest({ fetchImpl, credentials: { apiKey: 'k', secret: 's', passphrase: 'p' } })
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

  it('rejects when sCode is non-zero — as an OkxApiError carrying the business code', async () => {
    const { rest } = spyRest([{ ordId: '', clOrdId: 'tpxa1', sCode: '51008', sMsg: 'insufficient balance' }])
    const acc = new OkxAccount(rest)
    const err = await acc
      .placeOrder({ instId: 'BTC-USDT', tdMode: 'cash', side: 'buy', ordType: 'market', sz: '100', clOrdId: 'tpxa1' })
      .then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(OkxApiError)
    expect((err as OkxApiError).code).toBe('51008')
    expect(String(err)).toMatch(/51008/)
  })
})

describe('OkxAccount getOrder (P0-2b)', () => {
  it('GETs /api/v5/trade/order by clOrdId and returns the raw order', async () => {
    const { rest, calls } = spyRest([{ instId: 'BTC-USDT', ordId: 'o9', clOrdId: 'tpxa1', ordType: 'market', side: 'buy', sz: '0.2', state: 'filled', accFillSz: '0.2', avgPx: '40000' }])
    const acc = new OkxAccount(rest)
    const raw = await acc.getOrder('BTC-USDT', { clOrdId: 'tpxa1' })
    expect(raw).toMatchObject({ state: 'filled', accFillSz: '0.2' })
    expect(calls[0].url).toContain('/api/v5/trade/order?')
    expect(calls[0].url).toContain('clOrdId=tpxa1')
    expect(calls[0].init.method).toBe('GET')
  })

  it('returns null when OKX answers « does not exist » (51603)', async () => {
    const acc = new OkxAccount(errorRest('51603', 'Order does not exist'))
    expect(await acc.getOrder('BTC-USDT', { clOrdId: 'tpxa1' })).toBeNull()
  })

  it('returns null for an unknown algo order (51293)', async () => {
    const acc = new OkxAccount(errorRest('51293', 'The algo order does not exist'))
    expect(await acc.getAlgoOrder({ algoClOrdId: 'tpxa1' })).toBeNull()
  })

  it('propagates transport-level failures (unknown outcome ≠ not found)', async () => {
    const fetchImpl = (async () => {
      throw new Error('connection reset')
    }) as unknown as typeof fetch
    const rest = new OkxRest({ fetchImpl, credentials: { apiKey: 'k', secret: 's', passphrase: 'p' } })
    const acc = new OkxAccount(rest)
    await expect(acc.getOrder('BTC-USDT', { clOrdId: 'tpxa1' })).rejects.toThrow(/connection reset/)
  })
})
