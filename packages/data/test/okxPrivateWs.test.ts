import { describe, expect, it } from 'bun:test'
import { loginFrame, subscribeFrames } from '../src/okx/privateWs'

describe('okx private ws frames', () => {
  it('builds a login frame', () => {
    const f = loginFrame({ apiKey: 'k', secret: 's', passphrase: 'p' }, Date.parse('2026-06-27T09:08:57.715Z'))
    expect(f.op).toBe('login')
    expect(f.args[0]).toMatchObject({ apiKey: 'k', passphrase: 'p', timestamp: '1782551337' })
  })

  it('subscribes to orders, orders-algo and positions', () => {
    const subs = subscribeFrames()
    const channels = subs.flatMap((s) => (s.args as { channel: string }[]).map((a) => a.channel))
    expect(channels).toEqual(expect.arrayContaining(['orders', 'orders-algo', 'positions']))
  })
})
