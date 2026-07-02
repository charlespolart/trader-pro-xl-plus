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

  it('surfaces the per-item sCode when the envelope is code 1 with an empty msg (trade endpoints)', async () => {
    // cancel-order d'un ordre déjà parti : enveloppe { code:'1', msg:'' } et le
    // vrai code est dans data[0].sCode — il doit remonter dans l'erreur, sinon
    // la tolérance « déjà annulé » des appelants ne peut pas fonctionner.
    const rest = new OkxRest({
      fetchImpl: mockFetch({
        code: '1',
        msg: '',
        data: [{ sCode: '51400', sMsg: 'Cancellation failed as the order does not exist.' }],
      }) as unknown as typeof fetch,
    })
    try {
      await rest.public('/api/v5/trade/cancel-order')
      throw new Error('aurait dû rejeter')
    } catch (e) {
      expect(e).toBeInstanceOf(OkxApiError)
      expect((e as OkxApiError).code).toBe('51400')
      expect(String(e)).toMatch(/does not exist/)
    }
  })
})
