import { createHmac } from 'node:crypto'
import { sleep, type MarketType } from '@tpx/shared'
import { apiPrefix, endpointsFor } from './endpoints'

export interface BinanceCredentials {
  apiKey: string
  secret: string
}

export class BinanceApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: number,
    message: string,
  ) {
    super(`Binance ${status} (code ${code}): ${message}`)
  }
}

export interface BinanceRestOptions {
  market: MarketType
  testnet?: boolean
  credentials?: BinanceCredentials
  /** weight threshold (per minute) above which we proactively pause */
  weightSoftLimit?: number
}

type Params = Record<string, string | number | boolean | undefined>

/**
 * Minimal, robust Binance REST client (spot + USDT-M futures + testnets).
 * - HMAC-signed requests with server-time offset auto-sync
 * - proactive rate limiting from X-MBX-USED-WEIGHT headers
 * - 429 Retry-After honored, 418 (IP ban) surfaces immediately
 */
export class BinanceRest {
  private readonly base: string
  private readonly prefix: string
  private timeOffset = 0
  private timeSynced = false
  private usedWeight = 0
  private weightResetAt = 0

  constructor(private readonly o: BinanceRestOptions) {
    const ep = endpointsFor(o.market, o.testnet ?? false)
    this.base = ep.rest
    this.prefix = apiPrefix(o.market)
  }

  get market(): MarketType {
    return this.o.market
  }

  // ------------------------------------------------------------ public api

  async public<T>(path: string, params: Params = {}): Promise<T> {
    return this.request<T>('GET', path, params, false)
  }

  async signed<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, params: Params = {}): Promise<T> {
    return this.request<T>(method, path, params, true)
  }

  /** API-key header without signature (listenKey endpoints) */
  async keyed<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, params: Params = {}): Promise<T> {
    return this.request<T>(method, path, params, false, false, 0, true)
  }

  /** path relative to the market prefix, e.g. p('/klines') => /api/v3/klines */
  p(sub: string): string {
    return `${this.prefix}${sub}`
  }

  async syncTime(): Promise<void> {
    const before = Date.now()
    const { serverTime } = await this.request<{ serverTime: number }>('GET', this.p('/time'), {}, false, true)
    const rtt = Date.now() - before
    this.timeOffset = serverTime + rtt / 2 - Date.now()
    this.timeSynced = true
  }

  // -------------------------------------------------------------- internals

  private async request<T>(
    method: string,
    path: string,
    params: Params,
    sign: boolean,
    skipRateLimit = false,
    attempt = 0,
    keyOnly = false,
  ): Promise<T> {
    if (!skipRateLimit) await this.rateLimitGate()

    const search = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) search.set(k, String(v))
    }

    const headers: Record<string, string> = {}
    if (keyOnly) {
      const creds = this.o.credentials
      if (!creds) throw new Error('This endpoint requires an API key')
      headers['X-MBX-APIKEY'] = creds.apiKey
    }
    if (sign) {
      const creds = this.o.credentials
      if (!creds) throw new Error('This endpoint requires API credentials')
      if (!this.timeSynced) await this.syncTime()
      search.set('timestamp', String(Math.round(Date.now() + this.timeOffset)))
      search.set('recvWindow', '10000')
      const sig = createHmac('sha256', creds.secret).update(search.toString()).digest('hex')
      search.set('signature', sig)
      headers['X-MBX-APIKEY'] = creds.apiKey
    }

    const qs = search.toString()
    const url = `${this.base}${path}${qs ? `?${qs}` : ''}`
    const res = await fetch(url, { method, headers })

    const weightHeader =
      res.headers.get('x-mbx-used-weight-1m') ?? res.headers.get('x-mbx-used-weight')
    if (weightHeader) {
      this.usedWeight = Number(weightHeader)
      this.weightResetAt = Date.now() + (60_000 - (Date.now() % 60_000))
    }

    if (res.status === 429 || res.status === 418) {
      const retryAfter = Number(res.headers.get('retry-after') ?? '30')
      if (res.status === 418) {
        throw new BinanceApiError(418, -1003, `IP banned for ${retryAfter}s — stop hammering the API`)
      }
      if (attempt >= 5) throw new BinanceApiError(429, -1003, 'rate limited, retries exhausted')
      await sleep((retryAfter + 1) * 1000)
      return this.request<T>(method, path, params, sign, skipRateLimit, attempt + 1, keyOnly)
    }

    if (!res.ok) {
      let code = -1
      let msg = res.statusText
      try {
        const body = (await res.json()) as { code?: number; msg?: string }
        code = body.code ?? -1
        msg = body.msg ?? msg
      } catch {
        /* non-JSON error body */
      }
      // -1021: timestamp outside recvWindow — resync once and retry
      if (code === -1021 && attempt < 2) {
        await this.syncTime()
        return this.request<T>(method, path, params, sign, skipRateLimit, attempt + 1, keyOnly)
      }
      throw new BinanceApiError(res.status, code, msg)
    }

    return (await res.json()) as T
  }

  private async rateLimitGate(): Promise<void> {
    const soft = this.o.weightSoftLimit ?? (this.o.market === 'spot' ? 5400 : 2200)
    if (this.usedWeight >= soft && Date.now() < this.weightResetAt) {
      const wait = this.weightResetAt - Date.now() + 500
      await sleep(wait)
      this.usedWeight = 0
    }
  }
}
