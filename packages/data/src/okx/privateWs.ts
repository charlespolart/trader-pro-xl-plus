import type { ExchangePrivateStream } from '../exchange/types'
import { OKX_WS_PRIVATE, OKX_WS_PRIVATE_DEMO } from './endpoints'
import { okxWsLogin } from './sign'
import type { OkxCredentials, OkxOrderEvent, OkxPrivateEvent } from './types'

export function loginFrame(creds: OkxCredentials, now: number): { op: 'login'; args: object[] } {
  return { op: 'login', args: [okxWsLogin(creds.apiKey, creds.secret, creds.passphrase, now)] }
}

/** Pure decision for a `{event:'login'}` frame so it can be unit-tested in isolation. */
export function loginResult(msg: { code?: string; msg?: string }): { ok: boolean; error?: string } {
  if (msg.code === '0') return { ok: true }
  return { ok: false, error: `OKX WS login failed: ${msg.code} ${msg.msg ?? ''}`.trim() }
}

export function subscribeFrames(): { op: 'subscribe'; args: { channel: string; instType: string }[] }[] {
  return [
    { op: 'subscribe', args: [{ channel: 'orders', instType: 'ANY' }] },
    { op: 'subscribe', args: [{ channel: 'orders-algo', instType: 'ANY' }] },
    { op: 'subscribe', args: [{ channel: 'positions', instType: 'ANY' }] },
  ]
}

/**
 * One private socket per account (OKX unified account carries spot + swap).
 * Reconnects with backoff, re-logs-in, re-subscribes, and pings every 25s.
 */
export class OkxPrivateStream implements ExchangePrivateStream {
  private ws: WebSocket | null = null
  private cb: ((ev: OkxPrivateEvent) => void) | null = null
  private ping: ReturnType<typeof setInterval> | null = null
  private stopped = false
  private backoff = 1000

  constructor(
    private readonly creds: OkxCredentials,
    private readonly demo: boolean,
    private readonly onError: (e: Error) => void,
  ) {}

  onEvent(cb: (ev: OkxPrivateEvent) => void): void {
    this.cb = cb
  }

  async start(): Promise<void> {
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.ping) {
      clearInterval(this.ping)
      this.ping = null
    }
    this.ws?.close()
    this.ws = null
  }

  private connect(): void {
    const url = this.demo ? OKX_WS_PRIVATE_DEMO : OKX_WS_PRIVATE
    const ws = new WebSocket(url)
    this.ws = ws
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify(loginFrame(this.creds, Date.now())))
    })
    ws.addEventListener('message', (e) => this.onMessage(String(e.data)))
    ws.addEventListener('error', () => this.onError(new Error('OKX private ws error')))
    ws.addEventListener('close', () => {
      if (this.ping) {
        clearInterval(this.ping)
        this.ping = null
      }
      if (!this.stopped) {
        setTimeout(() => this.connect(), this.backoff)
        this.backoff = Math.min(this.backoff * 2, 30_000)
      }
    })
  }

  private onMessage(raw: string): void {
    if (raw === 'pong') return
    let msg: { event?: string; channel?: string; arg?: { channel: string }; data?: OkxOrderEvent[]; code?: string; msg?: string }
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (msg.event === 'login') {
      const res = loginResult(msg)
      if (!res.ok) {
        // Rejected login (bad creds / unauthorized IP): surface it and stop so the
        // close handler does NOT reconnect forever with onError never firing.
        this.onError(new Error(res.error))
        this.stop()
        return
      }
      this.backoff = 1000
      for (const f of subscribeFrames()) this.ws?.send(JSON.stringify(f))
      this.ping = setInterval(() => this.ws?.send('ping'), 25_000)
      return
    }
    if (msg.event === 'error') {
      // Channel-level error frame: report it but keep the socket (do not stop).
      this.onError(new Error(`OKX WS error: ${msg.code} ${msg.msg ?? ''}`.trim()))
      return
    }
    if (msg.arg?.channel && msg.data) {
      this.cb?.({ channel: msg.arg.channel, data: msg.data })
    }
  }
}
