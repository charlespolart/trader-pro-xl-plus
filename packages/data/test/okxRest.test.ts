import { describe, expect, it } from 'bun:test'
import { OkxApiError, OkxRest } from '../src/okx/rest'

function mockFetch(payload: unknown, status = 200) {
  return async () =>
    new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

describe('OkxRest', () => {
  it('unwraps the data array on code 0', async () => {
    const rest = new OkxRest({ fetchImpl: mockFetch({ code: '0', msg: '', data: [{ px: '1' }] }) as unknown as typeof fetch })
    const data = await rest.public<{ px: string }>('/api/v5/market/ticker', { instId: 'BTC-USDT' })
    expect(data).toEqual([{ px: '1' }])
  })

  it('throws OkxApiError on non-zero code', async () => {
    const rest = new OkxRest({ fetchImpl: mockFetch({ code: '51000', msg: 'bad param', data: [] }) as unknown as typeof fetch })
    await expect(rest.public('/api/v5/market/ticker')).rejects.toBeInstanceOf(OkxApiError)
  })

  it('requires credentials for signed calls', async () => {
    const rest = new OkxRest({ fetchImpl: mockFetch({ code: '0', msg: '', data: [] }) as unknown as typeof fetch })
    await expect(rest.signed('GET', '/api/v5/account/balance')).rejects.toThrow(/credentials/i)
  })
})
