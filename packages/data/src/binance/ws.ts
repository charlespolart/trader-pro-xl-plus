import type { AggTrade, Candle, Interval, MarketType } from '@tpx/shared'
import { endpointsFor } from './endpoints'

interface RawWsKline {
  t: number
  T: number
  o: string
  h: string
  l: string
  c: string
  v: string
  q: string
  n: number
  V: string
  Q: string
  /** candle closed */
  x: boolean
}

export function mapWsKline(k: RawWsKline): { candle: Candle; closed: boolean } {
  return {
    candle: {
      openTime: k.t,
      open: Number(k.o),
      high: Number(k.h),
      low: Number(k.l),
      close: Number(k.c),
      volume: Number(k.v),
      closeTime: k.T,
      quoteVolume: Number(k.q),
      trades: k.n,
      takerBuyBase: Number(k.V),
      takerBuyQuote: Number(k.Q),
    },
    closed: k.x,
  }
}

export function mapWsAggTrade(d: { a: number; p: string; q: string; T: number; m: boolean }): AggTrade {
  return { id: d.a, price: Number(d.p), qty: Number(d.q), time: d.T, isBuyerMaker: d.m }
}

export function klineStream(symbol: string, interval: Interval): string {
  return `${symbol.toLowerCase()}@kline_${interval}`
}

export function aggTradeStream(symbol: string): string {
  return `${symbol.toLowerCase()}@aggTrade`
}

export interface MarketWsHandlers {
  onMessage(stream: string, data: unknown): void
  onOpen?(): void
  onClose?(): void
}

/**
 * Combined market-data socket with dynamic SUBSCRIBE/UNSUBSCRIBE, automatic
 * reconnection (exponential backoff) and proactive 23h recycling (Binance
 * closes sockets at 24h).
 */
export class BinanceMarketWs {
  private ws: WebSocket | null = null
  private streams = new Set<string>()
  private msgId = 0
  private closed = false
  private backoffMs = 1000
  private recycleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly market: MarketType,
    private readonly testnet: boolean,
    private readonly handlers: MarketWsHandlers,
  ) {}

  connect(): void {
    this.closed = false
    this.open()
  }

  subscribe(streams: string[]): void {
    const fresh = streams.filter((s) => !this.streams.has(s))
    for (const s of fresh) this.streams.add(s)
    if (fresh.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: fresh, id: ++this.msgId }))
    }
  }

  unsubscribe(streams: string[]): void {
    const present = streams.filter((s) => this.streams.has(s))
    for (const s of present) this.streams.delete(s)
    if (present.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ method: 'UNSUBSCRIBE', params: present, id: ++this.msgId }))
    }
  }

  close(): void {
    this.closed = true
    if (this.recycleTimer) clearTimeout(this.recycleTimer)
    this.ws?.close()
    this.ws = null
  }

  private open(): void {
    const ep = endpointsFor(this.market, this.testnet)
    const ws = new WebSocket(`${ep.ws}/stream`)
    this.ws = ws

    ws.onopen = () => {
      this.backoffMs = 1000
      if (this.streams.size > 0) {
        ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: [...this.streams], id: ++this.msgId }))
      }
      this.handlers.onOpen?.()
      if (this.recycleTimer) clearTimeout(this.recycleTimer)
      this.recycleTimer = setTimeout(() => ws.close(), 23 * 3600 * 1000)
    }

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as { stream?: string; data?: unknown }
        if (msg.stream && msg.data !== undefined) {
          this.handlers.onMessage(msg.stream, msg.data)
        }
      } catch {
        /* ignore malformed frames */
      }
    }

    ws.onclose = () => {
      this.handlers.onClose?.()
      if (this.closed) return
      const delay = this.backoffMs
      this.backoffMs = Math.min(this.backoffMs * 2, 30_000)
      setTimeout(() => {
        if (!this.closed) this.open()
      }, delay)
    }

    ws.onerror = () => {
      /* onclose follows */
    }
  }
}

export interface UserStreamDeps {
  createListenKey(): Promise<string>
  keepAliveListenKey(key: string): Promise<void>
}

/**
 * User-data stream (order updates, balance updates) with listenKey keepalive
 * every 30 minutes and full re-handshake on disconnect or key expiry.
 */
export class BinanceUserStream {
  private ws: WebSocket | null = null
  private keepAlive: ReturnType<typeof setInterval> | null = null
  private closed = false
  private backoffMs = 1000

  constructor(
    private readonly market: MarketType,
    private readonly testnet: boolean,
    private readonly deps: UserStreamDeps,
    private readonly onEvent: (event: Record<string, unknown>) => void,
    private readonly onError?: (err: Error) => void,
  ) {}

  async start(): Promise<void> {
    this.closed = false
    await this.open()
  }

  stop(): void {
    this.closed = true
    if (this.keepAlive) clearInterval(this.keepAlive)
    this.ws?.close()
    this.ws = null
  }

  private async open(): Promise<void> {
    let key: string
    try {
      key = await this.deps.createListenKey()
    } catch (err) {
      this.onError?.(err instanceof Error ? err : new Error(String(err)))
      this.scheduleReconnect()
      return
    }

    const ep = endpointsFor(this.market, this.testnet)
    const ws = new WebSocket(`${ep.ws}/ws/${key}`)
    this.ws = ws

    if (this.keepAlive) clearInterval(this.keepAlive)
    this.keepAlive = setInterval(() => {
      this.deps.keepAliveListenKey(key).catch((err: unknown) => {
        this.onError?.(err instanceof Error ? err : new Error(String(err)))
      })
    }, 30 * 60 * 1000)

    ws.onopen = () => {
      this.backoffMs = 1000
    }

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as Record<string, unknown>
        if (msg['e'] === 'listenKeyExpired') {
          ws.close()
          return
        }
        this.onEvent(msg)
      } catch {
        /* ignore */
      }
    }

    ws.onclose = () => {
      if (this.keepAlive) clearInterval(this.keepAlive)
      if (!this.closed) this.scheduleReconnect()
    }

    ws.onerror = () => {
      /* onclose follows */
    }
  }

  private scheduleReconnect(): void {
    const delay = this.backoffMs
    this.backoffMs = Math.min(this.backoffMs * 2, 30_000)
    setTimeout(() => {
      if (!this.closed) void this.open()
    }, delay)
  }
}
