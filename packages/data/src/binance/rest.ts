import { sleep, type MarketType } from '@tpx/shared'
import { apiPrefix, endpointsFor } from './endpoints'

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
  /** weight threshold (per minute) above which we proactively pause */
  weightSoftLimit?: number
}

type Params = Record<string, string | number | boolean | undefined>

/**
 * Minimal, robust Binance REST client for PUBLIC market data (spot + USDT-M
 * futures + testnets). Trading/account endpoints moved to OKX — this client is
 * market-data only and never signs requests.
 * - proactive rate limiting from X-MBX-USED-WEIGHT headers
 * - 429 Retry-After honored, 418 (IP ban) surfaces immediately
 * - 451 geo-failover to the official data mirror for spot public endpoints
 */
/** official market-data-only mirror of the spot /api/v3 — not geo-blocked */
const SPOT_DATA_MIRROR = 'https://data-api.binance.vision'

export class BinanceRest {
  private base: string
  private readonly prefix: string
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
    return this.request<T>('GET', path, params)
  }

  /** path relative to the market prefix, e.g. p('/klines') => /api/v3/klines */
  p(sub: string): string {
    return `${this.prefix}${sub}`
  }

  // -------------------------------------------------------------- internals

  private async request<T>(method: string, path: string, params: Params, attempt = 0): Promise<T> {
    await this.rateLimitGate()

    const search = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) search.set(k, String(v))
    }

    const qs = search.toString()
    const url = `${this.base}${path}${qs ? `?${qs}` : ''}`
    const res = await fetch(url, { method })

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
      return this.request<T>(method, path, params, attempt + 1)
    }

    // 451: geo-restricted IP. Spot public endpoints transparently fail over
    // to the official data mirror.
    if (
      res.status === 451 &&
      this.o.market === 'spot' &&
      !(this.o.testnet ?? false) &&
      this.base !== SPOT_DATA_MIRROR
    ) {
      this.base = SPOT_DATA_MIRROR
      return this.request<T>(method, path, params, attempt)
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
      if (res.status === 451) {
        msg += ' [geo-restricted IP — Vision archives still work; run live trading from the VPS]'
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
