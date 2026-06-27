import { describe, expect, it } from 'bun:test'
import { okxSign, okxTimestamp, okxWsLogin } from '../src/okx/sign'

describe('okx signing', () => {
  it('formats timestamp as ISO-8601 ms UTC', () => {
    expect(okxTimestamp(Date.parse('2026-06-27T09:08:57.715Z'))).toBe('2026-06-27T09:08:57.715Z')
  })

  it('signs the prehash with HMAC-SHA256 base64', () => {
    // prehash = ts + method + path + body
    const sig = okxSign('secret', '2026-06-27T09:08:57.715Z', 'GET', '/api/v5/account/balance', '')
    // deterministic: same inputs => same signature, base64 charset
    expect(sig).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(okxSign('secret', '2026-06-27T09:08:57.715Z', 'GET', '/api/v5/account/balance', '')).toBe(sig)
    expect(okxSign('other', '2026-06-27T09:08:57.715Z', 'GET', '/api/v5/account/balance', '')).not.toBe(sig)
  })

  it('builds a WS login frame with epoch-SECONDS timestamp', () => {
    const f = okxWsLogin('k', 'secret', 'pass', Date.parse('2026-06-27T09:08:57.715Z'))
    expect(f.timestamp).toBe('1782551337') // floor(ms/1000)
    expect(f.apiKey).toBe('k')
    expect(f.passphrase).toBe('pass')
    expect(f.sign).toMatch(/^[A-Za-z0-9+/]+=*$/)
  })
})
