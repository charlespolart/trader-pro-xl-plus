import { describe, expect, it } from 'bun:test'
import { loginFrame, loginResult, subscribeFrames } from '../src/okx/privateWs'

describe('okx private ws frames', () => {
  it('builds a login frame', () => {
    const f = loginFrame({ apiKey: 'k', secret: 's', passphrase: 'p' }, Date.parse('2026-06-27T09:08:57.715Z'))
    expect(f.op).toBe('login')
    expect(f.args[0]).toMatchObject({ apiKey: 'k', passphrase: 'p', timestamp: '1782551337' })
  })

  it('subscribes to orders and positions (orders-algo is on the /business endpoint, not /private)', () => {
    const subs = subscribeFrames()
    const channels = subs.flatMap((s) => (s.args as { channel: string }[]).map((a) => a.channel))
    expect(channels).toEqual(expect.arrayContaining(['orders', 'positions']))
    expect(channels).not.toContain('orders-algo')
  })

  it('accepts a successful login frame', () => {
    expect(loginResult({ code: '0' })).toEqual({ ok: true })
  })

  it('rejects a failed login frame with a descriptive error', () => {
    const res = loginResult({ code: '60009', msg: 'Login failed' })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('OKX WS login failed: 60009 Login failed')
  })

  it('rejects a failed login frame even without a msg', () => {
    const res = loginResult({ code: '60012' })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('OKX WS login failed: 60012')
  })
})
