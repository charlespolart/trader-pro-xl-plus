# OKX Execution Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move trade execution (account, orders, fills, leverage/margin) from Binance to OKX while keeping all market data (backtest + live feeds) on Binance.

**Architecture:** Two independent planes. The *data plane* (Binance Vision archive + Binance public REST/WS market data) is untouched. The *execution plane* is rebuilt against OKX v5: a new `packages/data/src/okx/` package implements thin `ExchangeAccountClient` + `ExchangePrivateStream` interfaces, and a new `OKXLiveAdapter` (backend) implements the existing `ExecutionAdapter`. The strategy decides on Binance data and executes on OKX; real entry price / PnL come from OKX fills.

**Tech Stack:** Bun + TypeScript monorepo (`@tpx/*`), Drizzle + PostgreSQL, Hono, React 19 (web). Tests use `bun:test` (`describe/it/expect`) in `packages/<pkg>/test/*.test.ts`.

## Global Constraints

- Code and comments in **English**; user-facing UI copy may stay French to match existing pages.
- Data plane stays **Binance** — do not modify `packages/data/src/binance/market.ts`, `ws.ts` (`BinanceMarketWs`), `store/vision.ts`, the candle/aggTrade/funding stores, `liveFeeds.ts`, or the `flow` indicator.
- Execution venue is **OKX only**; no multi-exchange selector in the UI.
- Perp position mode = **net / one-way** (never pass hedge `posSide` long/short).
- **No BNB/OKB fee toggle** — OKX has no pay-with-token discount; remove `bnbDiscount`.
- `clOrdId` / `algoClOrdId` must be **alphanumeric only, 1–32 chars** (no underscore).
- OKX REST base = `https://www.okx.com`; demo = same base + header `x-simulated-trading: 1` (separate demo keys).
- OKX REST signature = `base64(HMAC_SHA256(secret, timestamp + method + requestPath + body))`, timestamp = ISO-8601 ms UTC (`new Date().toISOString()`).
- OKX WS login signature uses a **Unix-epoch-seconds** timestamp (not ISO).
- Default fees (OKX Regular): spot `{maker 0.0008, taker 0.0010}`, futures `{maker 0.0002, taker 0.0005}`.
- Every task ends green: `bun run typecheck` (or the touched package's `tsc --noEmit`) and `bun test` pass. Commit at the end of each task.
- Reference spec: `docs/superpowers/specs/2026-06-27-okx-execution-migration-design.md`.

---

## File Structure

**New (`packages/data/src/okx/`):**
- `types.ts` — OKX-facing TS types (`OkxInstType`, raw envelope, raw order/fill/position) + shared exchange interfaces.
- `sign.ts` — REST + WS signing helpers (pure functions).
- `endpoints.ts` — base URLs + demo header.
- `rest.ts` — `OkxRest` client (envelope unwrap, error, signed/public, injectable `fetchImpl`).
- `symbols.ts` — symbol ↔ instId mapping + contract conversion helpers (pure).
- `instruments.ts` — `OkxInstruments` (fetch + cache instrument meta).
- `account.ts` — `OkxAccount` (balances, positions, tradeFee, orders, algo orders, setLeverage).
- `orders.ts` — pure order-body builders + TPX↔OKX type/status maps + clOrdId helpers.
- `fills.ts` — pure parsers for OKX private `orders` events → normalized fill deltas.
- `privateWs.ts` — `OkxPrivateStream` (login, subscribe, ping, reconnect).

**New (`packages/data/src/exchange/`):**
- `types.ts` — `ExchangeAccountClient`, `ExchangePrivateStream`, shared DTOs.

**New (backend):**
- `apps/backend/src/services/okxLiveAdapter.ts` — `OKXLiveAdapter` + `OkxUserStreamRouter`.

**Modified:**
- `packages/shared/src/fees.ts` — OKX fee model.
- `packages/shared/src/market.ts` — `SymbolInfo.contractSize?`.
- `packages/data/src/index.ts` — export `okx/*`, drop deleted Binance trading exports.
- `packages/db/src/schema.ts` + new migration — `api_credentials.passphrase_enc`.
- `apps/backend/src/services/credentials.ts` — passphrase.
- `apps/backend/src/services/botManager.ts` — OKX wiring.
- `apps/backend/src/api.ts` — credentials route (passphrase), fee/level endpoint.
- `apps/web/src/pages/Settings.tsx` — passphrase field, demo toggle, OKX fee/level display.

**Deleted (end):** `packages/data/src/binance/account.ts`, `BinanceUserStream` (in `binance/ws.ts`), `apps/backend/src/services/liveAdapter.ts`, unused signed/keyed paths in `binance/rest.ts`.

---

## Task 1: OKX fee model

**Files:**
- Modify: `packages/shared/src/fees.ts`
- Test: `packages/shared/test/fees.test.ts` (create)
- Modify (callers): `packages/core/src/engine/simExchange.ts` and any other caller of `effectiveFeeRate`

**Interfaces:**
- Produces: `interface FeeConfig { makerRate: number; takerRate: number }`; `effectiveFeeRate(cfg: FeeConfig, maker: boolean): number`; `DEFAULT_FEES: Record<MarketType, FeeConfig>`; `FEE_TIER_PRESETS: Record<MarketType, { id: string; label: string; makerRate: number; takerRate: number }[]>`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/test/fees.test.ts
import { describe, expect, it } from 'bun:test'
import { DEFAULT_FEES, FEE_TIER_PRESETS, effectiveFeeRate } from '../src/fees'

describe('OKX fee model', () => {
  it('uses OKX Regular defaults', () => {
    expect(DEFAULT_FEES.spot).toEqual({ makerRate: 0.0008, takerRate: 0.001 })
    expect(DEFAULT_FEES.futures).toEqual({ makerRate: 0.0002, takerRate: 0.0005 })
  })

  it('returns maker or taker rate with no discount', () => {
    const cfg = { makerRate: 0.0008, takerRate: 0.001 }
    expect(effectiveFeeRate(cfg, true)).toBe(0.0008)
    expect(effectiveFeeRate(cfg, false)).toBe(0.001)
  })

  it('exposes selectable tier presets per market', () => {
    expect(FEE_TIER_PRESETS.spot[0].id).toBe('regular')
    expect(FEE_TIER_PRESETS.futures.some((t) => t.id === 'vip5')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/shared/test/fees.test.ts`
Expected: FAIL (`FEE_TIER_PRESETS` undefined / `effectiveFeeRate` arity).

- [ ] **Step 3: Rewrite `packages/shared/src/fees.ts`**

```ts
import type { MarketType } from './market'

export interface FeeConfig {
  /** e.g. 0.001 = 0.10% */
  makerRate: number
  takerRate: number
}

/** OKX "Regular" base tier (global fee framework, in force 2025-11-25). */
export const DEFAULT_FEES: Record<MarketType, FeeConfig> = {
  spot: { makerRate: 0.0008, takerRate: 0.001 },
  futures: { makerRate: 0.0002, takerRate: 0.0005 },
}

export interface FeeTierPreset {
  id: string
  label: string
  makerRate: number
  takerRate: number
}

/**
 * Published OKX schedule, indicative — actual rates vary by region/period and
 * are read live from /api/v5/account/trade-fee. Used to prefill backtest fees.
 */
export const FEE_TIER_PRESETS: Record<MarketType, FeeTierPreset[]> = {
  spot: [
    { id: 'regular', label: 'Regular', makerRate: 0.0008, takerRate: 0.001 },
    { id: 'vip1', label: 'VIP1', makerRate: 0.000675, takerRate: 0.0008 },
    { id: 'vip2', label: 'VIP2', makerRate: 0.0006, takerRate: 0.0007 },
    { id: 'vip3', label: 'VIP3', makerRate: 0.00055, takerRate: 0.00065 },
    { id: 'vip4', label: 'VIP4', makerRate: 0.0003, takerRate: 0.00045 },
    { id: 'vip5', label: 'VIP5', makerRate: 0.00025, takerRate: 0.00035 },
  ],
  futures: [
    { id: 'regular', label: 'Regular', makerRate: 0.0002, takerRate: 0.0005 },
    { id: 'vip1', label: 'VIP1', makerRate: 0.00018, takerRate: 0.0004 },
    { id: 'vip2', label: 'VIP2', makerRate: 0.00013, takerRate: 0.00035 },
    { id: 'vip3', label: 'VIP3', makerRate: 0.0001, takerRate: 0.00028 },
    { id: 'vip4', label: 'VIP4', makerRate: 0.00008, takerRate: 0.00027 },
    { id: 'vip5', label: 'VIP5', makerRate: 0.00005, takerRate: 0.00026 },
  ],
}

export function effectiveFeeRate(cfg: FeeConfig, maker: boolean): number {
  return maker ? cfg.makerRate : cfg.takerRate
}

export interface FundingEvent {
  symbol: string
  time: number
  /** signed rate; positive => longs pay shorts */
  rate: number
}
```

- [ ] **Step 4: Update callers**

Run: `grep -rn "effectiveFeeRate(\|bnbDiscount\|BNB_DISCOUNT\|DEFAULT_FEES" packages apps --include=*.ts | grep -v test`

For every `effectiveFeeRate(cfg, market, maker)` call, drop the middle arg → `effectiveFeeRate(cfg, maker)`. Remove any `bnbDiscount` field from `FeeConfig` literals and any UI reading `BNB_DISCOUNT`. If a `BotConfig`/`BacktestConfig` fee object set `bnbDiscount`, delete that property and its TS type field.

- [ ] **Step 5: Run tests + typecheck**

Run: `bun test packages/shared/test/fees.test.ts && bun run --filter '@tpx/shared' typecheck && bun run --filter '@tpx/core' typecheck`
Expected: PASS for all.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/fees.ts packages/shared/test/fees.test.ts packages/core/src/engine/simExchange.ts
git commit -m "feat(fees): OKX fee model, drop BNB discount, add tier presets"
```

---

## Task 2: OKX signing + endpoints

**Files:**
- Create: `packages/data/src/okx/sign.ts`, `packages/data/src/okx/endpoints.ts`, `packages/data/src/okx/types.ts`
- Create: `packages/data/src/exchange/types.ts`
- Test: `packages/data/test/okxSign.test.ts`

**Interfaces:**
- Produces: `okxTimestamp(now: number): string`; `okxSign(secret, timestamp, method, requestPath, body): string`; `okxWsLogin(apiKey, secret, passphrase, now): { apiKey; passphrase; timestamp; sign }`; `okxBaseUrl(): string`; `OKX_WS_PUBLIC` / `OKX_WS_PRIVATE` / `OKX_WS_PRIVATE_DEMO`; `demoHeaders(demo: boolean): Record<string,string>`.
- `OkxInstType = 'SPOT' | 'SWAP'`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/data/test/okxSign.test.ts
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
    expect(f.timestamp).toBe('1782637737') // floor(ms/1000)
    expect(f.apiKey).toBe('k')
    expect(f.passphrase).toBe('pass')
    expect(f.sign).toMatch(/^[A-Za-z0-9+/]+=*$/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/data/test/okxSign.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `packages/data/src/okx/sign.ts`**

```ts
import { createHmac } from 'node:crypto'

/** ISO-8601 with millisecond precision, UTC — required by OKX REST headers. */
export function okxTimestamp(now: number): string {
  return new Date(now).toISOString()
}

/** base64( HMAC_SHA256( secret, timestamp + method + requestPath + body ) ) */
export function okxSign(
  secret: string,
  timestamp: string,
  method: string,
  requestPath: string,
  body: string,
): string {
  return createHmac('sha256', secret).update(timestamp + method + requestPath + body).digest('base64')
}

/**
 * WS private login args. NOTE: OKX's WS login uses a UNIX-EPOCH-SECONDS
 * timestamp (string), unlike the ISO timestamp used for REST.
 */
export function okxWsLogin(
  apiKey: string,
  secret: string,
  passphrase: string,
  now: number,
): { apiKey: string; passphrase: string; timestamp: string; sign: string } {
  const timestamp = Math.floor(now / 1000).toString()
  const sign = createHmac('sha256', secret)
    .update(timestamp + 'GET' + '/users/self/verify')
    .digest('base64')
  return { apiKey, passphrase, timestamp, sign }
}
```

- [ ] **Step 4: Implement `packages/data/src/okx/endpoints.ts`**

```ts
export const OKX_REST_BASE = 'https://www.okx.com'
export const OKX_WS_PUBLIC = 'wss://ws.okx.com:8443/ws/v5/public'
export const OKX_WS_PRIVATE = 'wss://ws.okx.com:8443/ws/v5/private'
export const OKX_WS_PRIVATE_DEMO = 'wss://wspap.okx.com:8443/ws/v5/private'

export function okxBaseUrl(): string {
  return OKX_REST_BASE
}

/** Demo trading is the same base URL plus this header (with demo API keys). */
export function demoHeaders(demo: boolean): Record<string, string> {
  return demo ? { 'x-simulated-trading': '1' } : {}
}
```

- [ ] **Step 5: Implement `packages/data/src/okx/types.ts`**

```ts
export type OkxInstType = 'SPOT' | 'SWAP'

export interface OkxCredentials {
  apiKey: string
  secret: string
  passphrase: string
}

/** Standard OKX REST envelope. */
export interface OkxEnvelope<T> {
  code: string
  msg: string
  data: T[]
}

export interface OkxInstrumentRaw {
  instId: string
  instType: string
  tickSz: string
  lotSz: string
  minSz: string
  ctVal: string
  ctValCcy: string
  ctMult: string
  lever: string
  state: string
  baseCcy: string
  quoteCcy: string
}

export interface OkxOrderAck {
  ordId: string
  clOrdId: string
  algoId?: string
  algoClOrdId?: string
  sCode: string
  sMsg: string
}

/** A push from the private `orders` channel (one per fill or state change). */
export interface OkxOrderEvent {
  instId: string
  clOrdId: string
  ordId: string
  state: string // live | partially_filled | filled | canceled | mmp_canceled
  side: 'buy' | 'sell'
  fillSz?: string // last fill size, in contracts for SWAP
  fillPx?: string
  fillFee?: string // last fill fee, signed (negative = charged)
  fillFeeCcy?: string
  fillPnl?: string
  fillTime?: string
  accFillSz?: string
  avgPx?: string
}
```

- [ ] **Step 6: Implement `packages/data/src/exchange/types.ts`**

```ts
import type { Balance, MarketType } from '@tpx/shared'
import type { OkxInstType } from '../okx/types'

export interface ExchangeInstrument {
  instId: string
  tickSize: number
  stepSize: number
  minQty: number
  /** contract value in base currency (SWAP); 1 for spot */
  contractSize: number
  maxLeverage: number
}

export interface ExchangePosition {
  instId: string
  /** signed base quantity (already converted from contracts) */
  qty: number
  entryPrice: number
  leverage: number
  liquidationPrice: number | null
  unrealizedPnl: number
}

export interface ExchangeOrderAck {
  exchangeOrderId: string
  clientId: string
}

export interface ExchangeAccountClient {
  balances(market: MarketType): Promise<Balance[]>
  positions(instId: string): Promise<ExchangePosition[]>
  tradeFee(instType: OkxInstType, instId: string): Promise<{ maker: number; taker: number; level: string } | null>
  setLeverage(instId: string, leverage: number, mgnMode: 'isolated' | 'cross'): Promise<void>
  instrument(instId: string): Promise<ExchangeInstrument>
}
```

- [ ] **Step 7: Run test + typecheck**

Run: `bun test packages/data/test/okxSign.test.ts && bun run --filter '@tpx/data' typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/data/src/okx/sign.ts packages/data/src/okx/endpoints.ts packages/data/src/okx/types.ts packages/data/src/exchange/types.ts packages/data/test/okxSign.test.ts
git commit -m "feat(okx): signing, endpoints, exchange interfaces"
```

---

## Task 3: OkxRest client

**Files:**
- Create: `packages/data/src/okx/rest.ts`
- Test: `packages/data/test/okxRest.test.ts`

**Interfaces:**
- Consumes: `okxSign`, `okxTimestamp`, `okxBaseUrl`, `demoHeaders`, `OkxCredentials`, `OkxEnvelope`.
- Produces: `class OkxApiError extends Error { code: string; httpStatus: number }`; `class OkxRest` with `public<T>(path, params?)`, `signed<T>(method, path, params?, body?)`, options `{ demo?: boolean; credentials?: OkxCredentials; fetchImpl?: typeof fetch }`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/data/test/okxRest.test.ts
import { describe, expect, it } from 'bun:test'
import { OkxApiError, OkxRest } from '../src/okx/rest'

function mockFetch(payload: unknown, status = 200) {
  return async () =>
    new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

describe('OkxRest', () => {
  it('unwraps the data array on code 0', async () => {
    const rest = new OkxRest({ fetchImpl: mockFetch({ code: '0', msg: '', data: [{ px: '1' }] }) as typeof fetch })
    const data = await rest.public<{ px: string }>('/api/v5/market/ticker', { instId: 'BTC-USDT' })
    expect(data).toEqual([{ px: '1' }])
  })

  it('throws OkxApiError on non-zero code', async () => {
    const rest = new OkxRest({ fetchImpl: mockFetch({ code: '51000', msg: 'bad param', data: [] }) as typeof fetch })
    await expect(rest.public('/api/v5/market/ticker')).rejects.toBeInstanceOf(OkxApiError)
  })

  it('requires credentials for signed calls', async () => {
    const rest = new OkxRest({ fetchImpl: mockFetch({ code: '0', msg: '', data: [] }) as typeof fetch })
    await expect(rest.signed('GET', '/api/v5/account/balance')).rejects.toThrow(/credentials/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/data/test/okxRest.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `packages/data/src/okx/rest.ts`**

```ts
import { sleep } from '@tpx/shared'
import { demoHeaders, okxBaseUrl } from './endpoints'
import { okxSign, okxTimestamp } from './sign'
import type { OkxCredentials, OkxEnvelope } from './types'

type Params = Record<string, string | number | boolean | undefined>
type Method = 'GET' | 'POST'

export class OkxApiError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    message: string,
  ) {
    super(`OKX ${httpStatus} (code ${code}): ${message}`)
  }
}

export interface OkxRestOptions {
  demo?: boolean
  credentials?: OkxCredentials
  fetchImpl?: typeof fetch
}

export class OkxRest {
  private readonly base = okxBaseUrl()
  private readonly fetchImpl: typeof fetch

  constructor(private readonly o: OkxRestOptions = {}) {
    this.fetchImpl = o.fetchImpl ?? fetch
  }

  async public<T>(path: string, params: Params = {}): Promise<T[]> {
    return this.request<T>('GET', path, params, undefined, false)
  }

  async signed<T>(method: Method, path: string, params: Params = {}, body?: unknown): Promise<T[]> {
    return this.request<T>(method, path, params, body, true)
  }

  private query(params: Params): string {
    const s = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v !== undefined) s.set(k, String(v))
    const q = s.toString()
    return q ? `?${q}` : ''
  }

  private async request<T>(
    method: Method,
    path: string,
    params: Params,
    body: unknown,
    sign: boolean,
    attempt = 0,
  ): Promise<T[]> {
    const qs = method === 'GET' ? this.query(params) : ''
    const requestPath = `${path}${qs}`
    const bodyStr = method === 'POST' && body !== undefined ? JSON.stringify(body) : ''
    const headers: Record<string, string> = { ...demoHeaders(this.o.demo ?? false) }
    if (bodyStr) headers['Content-Type'] = 'application/json'

    if (sign) {
      const c = this.o.credentials
      if (!c) throw new Error('This endpoint requires API credentials')
      const ts = okxTimestamp(Date.now())
      headers['OK-ACCESS-KEY'] = c.apiKey
      headers['OK-ACCESS-PASSPHRASE'] = c.passphrase
      headers['OK-ACCESS-TIMESTAMP'] = ts
      headers['OK-ACCESS-SIGN'] = okxSign(c.secret, ts, method, requestPath, bodyStr)
    }

    const res = await this.fetchImpl(`${this.base}${requestPath}`, {
      method,
      headers,
      body: bodyStr || undefined,
    })

    if (res.status === 429 && attempt < 5) {
      await sleep(1000 * (attempt + 1))
      return this.request<T>(method, path, params, body, sign, attempt + 1)
    }

    let env: OkxEnvelope<T>
    try {
      env = (await res.json()) as OkxEnvelope<T>
    } catch {
      throw new OkxApiError('-1', res.status, res.statusText)
    }
    if (env.code !== '0') throw new OkxApiError(env.code, res.status, env.msg || res.statusText)
    return env.data
  }
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `bun test packages/data/test/okxRest.test.ts && bun run --filter '@tpx/data' typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/data/src/okx/rest.ts packages/data/test/okxRest.test.ts
git commit -m "feat(okx): REST client with envelope unwrap, signing, demo header"
```

---

## Task 4: Symbol mapping + contract conversion

**Files:**
- Create: `packages/data/src/okx/symbols.ts`
- Modify: `packages/shared/src/market.ts` (add `SymbolInfo.contractSize?`)
- Test: `packages/data/test/okxSymbols.test.ts`

**Interfaces:**
- Consumes: `floorToStep` from `@tpx/shared`.
- Produces: `toInstId(base, quote, market): string`; `instType(market): OkxInstType`; `baseToContracts(baseQty, ctVal, lotSz): number`; `contractsToBase(contracts, ctVal): number`.

- [ ] **Step 1: Add `contractSize?` to SymbolInfo**

In `packages/shared/src/market.ts`, add to the `SymbolInfo` interface (after `maxLeverage?`):

```ts
  /** OKX SWAP contract value in base currency (ctVal); undefined/1 for spot */
  contractSize?: number
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/data/test/okxSymbols.test.ts
import { describe, expect, it } from 'bun:test'
import { baseToContracts, contractsToBase, instType, toInstId } from '../src/okx/symbols'

describe('okx symbols', () => {
  it('maps base/quote to instId per market', () => {
    expect(toInstId('BTC', 'USDT', 'spot')).toBe('BTC-USDT')
    expect(toInstId('BTC', 'USDT', 'futures')).toBe('BTC-USDT-SWAP')
  })

  it('maps market to OKX instType', () => {
    expect(instType('spot')).toBe('SPOT')
    expect(instType('futures')).toBe('SWAP')
  })

  it('converts base qty to whole contracts floored to lotSz', () => {
    // ctVal 0.01 BTC, lotSz 1 contract => 0.055 BTC -> 5 contracts
    expect(baseToContracts(0.055, 0.01, 1)).toBe(5)
    expect(contractsToBase(5, 0.01)).toBeCloseTo(0.05, 10)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test packages/data/test/okxSymbols.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `packages/data/src/okx/symbols.ts`**

```ts
import { floorToStep, type MarketType } from '@tpx/shared'
import type { OkxInstType } from './types'

export function instType(market: MarketType): OkxInstType {
  return market === 'spot' ? 'SPOT' : 'SWAP'
}

export function toInstId(base: string, quote: string, market: MarketType): string {
  return market === 'spot' ? `${base}-${quote}` : `${base}-${quote}-SWAP`
}

/** base coin quantity -> whole number of OKX contracts, floored to lotSz */
export function baseToContracts(baseQty: number, ctVal: number, lotSz: number): number {
  if (ctVal <= 0) return 0
  return floorToStep(baseQty / ctVal, lotSz)
}

export function contractsToBase(contracts: number, ctVal: number): number {
  return contracts * ctVal
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `bun test packages/data/test/okxSymbols.test.ts && bun run --filter '@tpx/shared' typecheck && bun run --filter '@tpx/data' typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/market.ts packages/data/src/okx/symbols.ts packages/data/test/okxSymbols.test.ts
git commit -m "feat(okx): symbol/instId mapping and contract conversion"
```

---

## Task 5: clOrdId + order/status mapping helpers

**Files:**
- Create: `packages/data/src/okx/orders.ts`
- Test: `packages/data/test/okxOrders.test.ts`

**Interfaces:**
- Consumes: `OrderType`, `OrderStatus`, `OrderRequest`, `MarketType`, `floorToStep`, `isTriggerOrder` from `@tpx/shared`; `baseToContracts` from `./symbols`.
- Produces:
  - `clOrdPrefix(botId): string`
  - `makeClOrdId(prefix, seq): string`
  - `mapOrdType(type, market): { algo: boolean; ordType: string }`
  - `mapOkxState(state, type, executedQty): OrderStatus`
  - `buildOrderBody(args): Record<string, unknown>` and `buildAlgoBody(args): Record<string, unknown>` where
    `args = { instId; market; req: OrderRequest; clOrdId; ctVal: number; lotSz: number; refPrice: number }`

- [ ] **Step 1: Write the failing test**

```ts
// packages/data/test/okxOrders.test.ts
import { describe, expect, it } from 'bun:test'
import type { OrderRequest } from '@tpx/shared'
import {
  buildAlgoBody,
  buildOrderBody,
  clOrdPrefix,
  makeClOrdId,
  mapOkxState,
  mapOrdType,
} from '../src/okx/orders'

describe('okx orders', () => {
  it('builds an alphanumeric clOrdId <= 32 chars (no underscore)', () => {
    const prefix = clOrdPrefix('5708eef0-1234-5678')
    const id = makeClOrdId(prefix, 42)
    expect(id).toMatch(/^[a-z0-9]{1,32}$/i)
    expect(id.startsWith(prefix)).toBe(true)
  })

  it('routes stops to algo orders', () => {
    expect(mapOrdType('MARKET', 'spot')).toEqual({ algo: false, ordType: 'market' })
    expect(mapOrdType('LIMIT_MAKER', 'futures')).toEqual({ algo: false, ordType: 'post_only' })
    expect(mapOrdType('STOP_MARKET', 'futures')).toEqual({ algo: true, ordType: 'trigger' })
  })

  it('maps OKX state to TPX status', () => {
    expect(mapOkxState('live', 'STOP_MARKET', 0)).toBe('TRIGGER_PENDING')
    expect(mapOkxState('live', 'LIMIT', 0)).toBe('NEW')
    expect(mapOkxState('partially_filled', 'LIMIT', 1)).toBe('PARTIALLY_FILLED')
    expect(mapOkxState('filled', 'LIMIT', 1)).toBe('FILLED')
    expect(mapOkxState('canceled', 'LIMIT', 0)).toBe('CANCELED')
  })

  it('spot market buy sized in quote uses tgtCcy=quote_ccy', () => {
    const req: OrderRequest = { side: 'BUY', type: 'MARKET', quoteQty: 100 }
    const body = buildOrderBody({
      instId: 'BTC-USDT', market: 'spot', req, clOrdId: 'tpxabc1', ctVal: 1, lotSz: 0.0001, refPrice: 50000,
    })
    expect(body).toMatchObject({ instId: 'BTC-USDT', tdMode: 'cash', side: 'buy', ordType: 'market', sz: '100', tgtCcy: 'quote_ccy' })
  })

  it('futures market sells size in contracts and sets reduceOnly', () => {
    const req: OrderRequest = { side: 'SELL', type: 'MARKET', qty: 0.05, reduceOnly: true }
    const body = buildOrderBody({
      instId: 'BTC-USDT-SWAP', market: 'futures', req, clOrdId: 'tpxabc2', ctVal: 0.01, lotSz: 1, refPrice: 50000,
    })
    expect(body).toMatchObject({ instId: 'BTC-USDT-SWAP', tdMode: 'isolated', side: 'sell', ordType: 'market', sz: '5', reduceOnly: 'true' })
  })

  it('builds an algo body for stop-market with market trigger price', () => {
    const req: OrderRequest = { side: 'SELL', type: 'STOP_MARKET', qty: 0.05, stopPrice: 48000, reduceOnly: true }
    const body = buildAlgoBody({
      instId: 'BTC-USDT-SWAP', market: 'futures', req, clOrdId: 'tpxabc3', ctVal: 0.01, lotSz: 1, refPrice: 50000,
    })
    expect(body).toMatchObject({ ordType: 'trigger', triggerPx: '48000', orderPx: '-1', sz: '5', reduceOnly: 'true' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/data/test/okxOrders.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `packages/data/src/okx/orders.ts`**

```ts
import { isTriggerOrder, type MarketType, type OrderRequest, type OrderStatus, type OrderType } from '@tpx/shared'
import { baseToContracts } from './symbols'

export function clOrdPrefix(botId: string): string {
  return 'tpx' + botId.replace(/[^a-z0-9]/gi, '').slice(0, 8)
}

export function makeClOrdId(prefix: string, seq: number): string {
  return (prefix + seq.toString(36)).slice(0, 32)
}

export function mapOrdType(type: OrderType, market: MarketType): { algo: boolean; ordType: string } {
  if (isTriggerOrder(type)) return { algo: true, ordType: 'trigger' }
  if (type === 'LIMIT_MAKER') return { algo: false, ordType: 'post_only' }
  if (type === 'MARKET') return { algo: false, ordType: 'market' }
  return { algo: false, ordType: 'limit' }
}

export function mapOkxState(state: string, type: OrderType, executedQty: number): OrderStatus {
  switch (state) {
    case 'live':
      return isTriggerOrder(type) && executedQty === 0 ? 'TRIGGER_PENDING' : 'NEW'
    case 'partially_filled':
      return 'PARTIALLY_FILLED'
    case 'filled':
      return 'FILLED'
    case 'canceled':
    case 'mmp_canceled':
      return 'CANCELED'
    case 'order_failed':
      return 'REJECTED'
    default:
      return 'NEW'
  }
}

function tdMode(market: MarketType): string {
  return market === 'spot' ? 'cash' : 'isolated'
}

/** size string in OKX units: contracts (SWAP) or base/quote coin (spot) */
function sizeFor(args: BuildArgs): { sz: string; tgtCcy?: string } {
  const { market, req, ctVal, lotSz, refPrice } = args
  if (market === 'futures') {
    const base = req.qty ?? (req.quoteQty && refPrice > 0 ? req.quoteQty / refPrice : 0)
    return { sz: String(baseToContracts(base, ctVal, lotSz)) }
  }
  // spot
  if (req.type === 'MARKET' && req.quoteQty !== undefined && req.qty === undefined) {
    return { sz: String(req.quoteQty), tgtCcy: 'quote_ccy' }
  }
  return { sz: String(req.qty ?? 0), tgtCcy: req.type === 'MARKET' ? 'base_ccy' : undefined }
}

export interface BuildArgs {
  instId: string
  market: MarketType
  req: OrderRequest
  clOrdId: string
  ctVal: number
  lotSz: number
  refPrice: number
}

export function buildOrderBody(args: BuildArgs): Record<string, unknown> {
  const { instId, market, req, clOrdId } = args
  const { ordType } = mapOrdType(req.type, market)
  const { sz, tgtCcy } = sizeFor(args)
  const body: Record<string, unknown> = {
    instId,
    tdMode: tdMode(market),
    side: req.side.toLowerCase(),
    ordType,
    sz,
    clOrdId,
  }
  if (req.price !== undefined) body.px = String(req.price)
  if (tgtCcy) body.tgtCcy = tgtCcy
  if (market === 'futures' && req.reduceOnly) body.reduceOnly = 'true'
  return body
}

export function buildAlgoBody(args: BuildArgs): Record<string, unknown> {
  const { instId, market, req, clOrdId } = args
  const { sz } = sizeFor(args)
  const isLimit = req.type === 'STOP_LIMIT' || req.type === 'TAKE_PROFIT_LIMIT'
  const body: Record<string, unknown> = {
    instId,
    tdMode: tdMode(market),
    side: req.side.toLowerCase(),
    ordType: 'trigger',
    sz,
    algoClOrdId: clOrdId,
    triggerPx: String(req.stopPrice ?? 0),
    orderPx: isLimit && req.price !== undefined ? String(req.price) : '-1',
    triggerPxType: 'last',
  }
  if (market === 'futures' && req.reduceOnly) body.reduceOnly = 'true'
  return body
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `bun test packages/data/test/okxOrders.test.ts && bun run --filter '@tpx/data' typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/data/src/okx/orders.ts packages/data/test/okxOrders.test.ts
git commit -m "feat(okx): order/algo body builders, clOrdId, status mapping"
```

---

## Task 6: OKX fill-event parser

**Files:**
- Create: `packages/data/src/okx/fills.ts`
- Test: `packages/data/test/okxFills.test.ts`

**Interfaces:**
- Consumes: `OkxOrderEvent`, `contractsToBase`.
- Produces: `parseFill(ev: OkxOrderEvent, market: MarketType, ctVal: number): FillDelta | null` where
  `interface FillDelta { lastQty: number; price: number; fee: number; feeCcy: string; pnl: number; time: number; maker: boolean }`.
  `lastQty` is in **base** units; `fee` is a **positive cost** (OKX sign flipped); `maker` is unknown from this channel → derive from whether `ordType` was post_only is not available here, so default `false` (taker) and refine later. (See spec §14: confirm maker flag source.)

- [ ] **Step 1: Write the failing test**

```ts
// packages/data/test/okxFills.test.ts
import { describe, expect, it } from 'bun:test'
import { parseFill } from '../src/okx/fills'
import type { OkxOrderEvent } from '../src/okx/types'

describe('parseFill', () => {
  it('returns null when there is no fill on the event', () => {
    const ev: OkxOrderEvent = { instId: 'BTC-USDT-SWAP', clOrdId: 'tpxa1', ordId: '1', state: 'live', side: 'buy' }
    expect(parseFill(ev, 'futures', 0.01)).toBeNull()
  })

  it('converts contracts to base and flips the fee sign', () => {
    const ev: OkxOrderEvent = {
      instId: 'BTC-USDT-SWAP', clOrdId: 'tpxa1', ordId: '1', state: 'partially_filled', side: 'buy',
      fillSz: '5', fillPx: '50000', fillFee: '-0.025', fillFeeCcy: 'USDT', fillPnl: '0', fillTime: '1782637737000',
    }
    const d = parseFill(ev, 'futures', 0.01)
    expect(d).toEqual({ lastQty: 0.05, price: 50000, fee: 0.025, feeCcy: 'USDT', pnl: 0, time: 1782637737000, maker: false })
  })

  it('keeps spot fill size as-is (ctVal 1)', () => {
    const ev: OkxOrderEvent = {
      instId: 'BTC-USDT', clOrdId: 'tpxa1', ordId: '1', state: 'filled', side: 'sell',
      fillSz: '0.01', fillPx: '50000', fillFee: '-0.5', fillFeeCcy: 'USDT', fillPnl: '0', fillTime: '1782637737000',
    }
    const d = parseFill(ev, 'spot', 1)
    expect(d?.lastQty).toBeCloseTo(0.01, 10)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/data/test/okxFills.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `packages/data/src/okx/fills.ts`**

```ts
import type { MarketType } from '@tpx/shared'
import { contractsToBase } from './symbols'
import type { OkxOrderEvent } from './types'

export interface FillDelta {
  /** base units */
  lastQty: number
  price: number
  /** positive cost in feeCcy */
  fee: number
  feeCcy: string
  pnl: number
  time: number
  maker: boolean
}

export function parseFill(ev: OkxOrderEvent, market: MarketType, ctVal: number): FillDelta | null {
  const fillSz = Number(ev.fillSz ?? 0)
  const price = Number(ev.fillPx ?? 0)
  if (!(fillSz > 0) || !(price > 0)) return null
  const lastQty = market === 'futures' ? contractsToBase(fillSz, ctVal) : fillSz
  return {
    lastQty,
    price,
    fee: Math.abs(Number(ev.fillFee ?? 0)),
    feeCcy: ev.fillFeeCcy ?? '',
    pnl: Number(ev.fillPnl ?? 0),
    time: Number(ev.fillTime ?? Date.now()),
    maker: false,
  }
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `bun test packages/data/test/okxFills.test.ts && bun run --filter '@tpx/data' typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/data/src/okx/fills.ts packages/data/test/okxFills.test.ts
git commit -m "feat(okx): private fill-event parser (contracts->base, fee sign)"
```

---

## Task 7: OkxInstruments + OkxAccount (reads)

**Files:**
- Create: `packages/data/src/okx/instruments.ts`, `packages/data/src/okx/account.ts`
- Test: `packages/data/test/okxAccount.test.ts`

**Interfaces:**
- Consumes: `OkxRest`, `ExchangeInstrument`, `ExchangePosition`, `Balance`, `instType`, `contractsToBase`.
- Produces:
  - `class OkxInstruments { constructor(rest: OkxRest); get(instId, instTypeStr): Promise<ExchangeInstrument> }` (cached).
  - `class OkxAccount` implementing the read half of `ExchangeAccountClient`: `balances`, `positions`, `tradeFee`, `setLeverage`, `instrument`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/data/test/okxAccount.test.ts
import { describe, expect, it } from 'bun:test'
import { OkxRest } from '../src/okx/rest'
import { OkxAccount } from '../src/okx/account'

function restReturning(data: unknown[]) {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ code: '0', msg: '', data }), { status: 200 })) as unknown as typeof fetch
  return new OkxRest({ fetchImpl, credentials: { apiKey: 'k', secret: 's', passphrase: 'p' } })
}

describe('OkxAccount reads', () => {
  it('parses an instrument (tickSz/lotSz/minSz/ctVal/lever)', async () => {
    const acc = new OkxAccount(restReturning([
      { instId: 'BTC-USDT-SWAP', instType: 'SWAP', tickSz: '0.1', lotSz: '1', minSz: '1', ctVal: '0.01', ctValCcy: 'BTC', ctMult: '1', lever: '125', state: 'live', baseCcy: '', quoteCcy: '' },
    ]))
    const inst = await acc.instrument('BTC-USDT-SWAP')
    expect(inst).toMatchObject({ tickSize: 0.1, stepSize: 1, minQty: 1, contractSize: 0.01, maxLeverage: 125 })
  })

  it('converts SWAP positions from contracts to signed base qty', async () => {
    const acc = new OkxAccount(restReturning([
      { instId: 'BTC-USDT-SWAP', pos: '-5', avgPx: '50000', lever: '10', liqPx: '60000', upl: '-12.5' },
    ]))
    // ctVal must be known; OkxAccount.positions fetches the instrument internally.
    // For the test, stub instrument via a second OkxRest is overkill — assert raw mapping with ctVal=0.01:
    const pos = await acc.positions('BTC-USDT-SWAP')
    expect(pos[0]).toMatchObject({ instId: 'BTC-USDT-SWAP', qty: -0.05, entryPrice: 50000, leverage: 10, unrealizedPnl: -12.5 })
  })

  it('parses trade-fee and flips sign to positive rates', async () => {
    const acc = new OkxAccount(restReturning([{ maker: '-0.0008', taker: '-0.001', makerU: '-0.0002', takerU: '-0.0005', level: 'Lv1' }]))
    const fee = await acc.tradeFee('SWAP', 'BTC-USDT-SWAP')
    expect(fee).toEqual({ maker: 0.0002, taker: 0.0005, level: 'Lv1' })
  })
})
```

> Note: `positions` needs `ctVal`. Implement `OkxAccount.positions` to first resolve the instrument (via the cached `OkxInstruments`), then convert. In the test the same stubbed REST returns the position payload for both calls; assert on the position fields and accept that `instrument()` here returns defaults (ctVal parsed from the same stub if present). If this coupling is awkward, split: have `positions(instId, ctVal)` take ctVal as a param and let the caller (adapter) pass the cached instrument's contractSize. **Prefer the param version** — it keeps `OkxAccount` pure and matches how the adapter already holds `symbolInfo`.

Adjust the test to the param version:

```ts
  it('converts SWAP positions from contracts to signed base qty', async () => {
    const acc = new OkxAccount(restReturning([
      { instId: 'BTC-USDT-SWAP', pos: '-5', avgPx: '50000', lever: '10', liqPx: '60000', upl: '-12.5' },
    ]))
    const pos = await acc.positions('BTC-USDT-SWAP', 0.01)
    expect(pos[0]).toMatchObject({ qty: -0.05, entryPrice: 50000, leverage: 10, unrealizedPnl: -12.5 })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/data/test/okxAccount.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `packages/data/src/okx/instruments.ts`**

```ts
import type { ExchangeInstrument } from '../exchange/types'
import type { OkxRest } from './rest'
import type { OkxInstType, OkxInstrumentRaw } from './types'

function parseInstrument(r: OkxInstrumentRaw): ExchangeInstrument {
  const ctVal = Number(r.ctVal)
  return {
    instId: r.instId,
    tickSize: Number(r.tickSz),
    stepSize: Number(r.lotSz),
    minQty: Number(r.minSz),
    contractSize: r.instType === 'SWAP' && ctVal > 0 ? ctVal : 1,
    maxLeverage: Number(r.lever) || 1,
  }
}

export class OkxInstruments {
  private cache = new Map<string, ExchangeInstrument>()
  constructor(private readonly rest: OkxRest) {}

  async get(instId: string, instType: OkxInstType): Promise<ExchangeInstrument> {
    const hit = this.cache.get(instId)
    if (hit) return hit
    const rows = await this.rest.public<OkxInstrumentRaw>('/api/v5/public/instruments', { instType, instId })
    const row = rows.find((x) => x.instId === instId) ?? rows[0]
    if (!row) throw new Error(`OKX instrument not found: ${instId}`)
    const inst = parseInstrument(row)
    this.cache.set(instId, inst)
    return inst
  }
}
```

- [ ] **Step 4: Implement `packages/data/src/okx/account.ts` (reads)**

```ts
import type { Balance, MarketType } from '@tpx/shared'
import type { ExchangeInstrument, ExchangePosition } from '../exchange/types'
import { OkxInstruments } from './instruments'
import type { OkxRest } from './rest'
import { contractsToBase, instType } from './symbols'
import type { OkxInstType } from './types'

interface RawBalanceDetail { ccy: string; availBal: string; frozenBal: string }
interface RawPosition { instId: string; pos: string; avgPx: string; lever: string; liqPx: string; upl: string }
interface RawTradeFee { maker: string; taker: string; makerU: string; takerU: string; level: string }

export class OkxAccount {
  private readonly instruments: OkxInstruments
  constructor(private readonly rest: OkxRest) {
    this.instruments = new OkxInstruments(rest)
  }

  instrument(instId: string): Promise<ExchangeInstrument> {
    const t: OkxInstType = instId.endsWith('-SWAP') ? 'SWAP' : 'SPOT'
    return this.instruments.get(instId, t)
  }

  async balances(_market: MarketType): Promise<Balance[]> {
    const rows = await this.rest.signed<{ details: RawBalanceDetail[] }>('GET', '/api/v5/account/balance')
    const details = rows[0]?.details ?? []
    return details.map((d) => ({
      asset: d.ccy,
      free: Number(d.availBal),
      locked: Number(d.frozenBal),
    }))
  }

  /** ctVal: the instrument's contractSize (caller passes its cached value). */
  async positions(instId: string, ctVal: number): Promise<ExchangePosition[]> {
    const rows = await this.rest.signed<RawPosition>('GET', '/api/v5/account/positions', {
      instType: 'SWAP',
      instId,
    })
    return rows.map((p) => ({
      instId: p.instId,
      qty: contractsToBase(Number(p.pos), ctVal),
      entryPrice: Number(p.avgPx) || 0,
      leverage: Number(p.lever) || 1,
      liquidationPrice: Number(p.liqPx) || null,
      unrealizedPnl: Number(p.upl) || 0,
    }))
  }

  async tradeFee(t: OkxInstType, instId: string): Promise<{ maker: number; taker: number; level: string } | null> {
    try {
      const rows = await this.rest.signed<RawTradeFee>('GET', '/api/v5/account/trade-fee', { instType: t, instId })
      const r = rows[0]
      if (!r) return null
      // OKX rates are negative when charged; backtester wants positive cost.
      const maker = Math.abs(Number(t === 'SWAP' ? r.makerU : r.maker))
      const taker = Math.abs(Number(t === 'SWAP' ? r.takerU : r.taker))
      return { maker, taker, level: r.level }
    } catch {
      return null
    }
  }

  async setLeverage(instId: string, leverage: number, mgnMode: 'isolated' | 'cross'): Promise<void> {
    await this.rest.signed('POST', '/api/v5/account/set-leverage', {}, {
      instId,
      lever: String(leverage),
      mgnMode,
    })
  }

  // raw helper for the symbol type
  static instTypeFor = instType
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `bun test packages/data/test/okxAccount.test.ts && bun run --filter '@tpx/data' typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/data/src/okx/instruments.ts packages/data/src/okx/account.ts packages/data/test/okxAccount.test.ts
git commit -m "feat(okx): instruments cache + account reads (balances/positions/tradeFee/leverage)"
```

---

## Task 8: OkxAccount order placement (writes)

**Files:**
- Modify: `packages/data/src/okx/account.ts`
- Test: `packages/data/test/okxAccountOrders.test.ts`

**Interfaces:**
- Consumes: `buildOrderBody`, `buildAlgoBody`, `OkxOrderAck`.
- Produces (on `OkxAccount`): `placeOrder(body): Promise<OkxOrderAck>`, `placeAlgoOrder(body): Promise<OkxOrderAck>`, `cancelOrder(instId, ids)`, `cancelAlgoOrder(instId, ids)`, `openOrders(instId)`, `openAlgoOrders(instId)`. (These take/return raw OKX shapes; the adapter builds bodies via Task 5 helpers.)

- [ ] **Step 1: Write the failing test**

```ts
// packages/data/test/okxAccountOrders.test.ts
import { describe, expect, it } from 'bun:test'
import { OkxRest } from '../src/okx/rest'
import { OkxAccount } from '../src/okx/account'

function spyRest(data: unknown[]) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify({ code: '0', msg: '', data }), { status: 200 })
  }) as unknown as typeof fetch
  return { rest: new OkxRest({ fetchImpl, credentials: { apiKey: 'k', secret: 's', passphrase: 'p' } }), calls }
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

  it('rejects when sCode is non-zero', async () => {
    const { rest } = spyRest([{ ordId: '', clOrdId: 'tpxa1', sCode: '51008', sMsg: 'insufficient balance' }])
    const acc = new OkxAccount(rest)
    await expect(
      acc.placeOrder({ instId: 'BTC-USDT', tdMode: 'cash', side: 'buy', ordType: 'market', sz: '100', clOrdId: 'tpxa1' }),
    ).rejects.toThrow(/51008/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/data/test/okxAccountOrders.test.ts`
Expected: FAIL (method not defined).

- [ ] **Step 3: Add order methods to `OkxAccount`**

Append to the class:

```ts
  async placeOrder(body: Record<string, unknown>): Promise<OkxOrderAck> {
    const rows = await this.rest.signed<OkxOrderAck>('POST', '/api/v5/trade/order', {}, body)
    return this.checkAck(rows[0])
  }

  async placeAlgoOrder(body: Record<string, unknown>): Promise<OkxOrderAck> {
    const rows = await this.rest.signed<OkxOrderAck>('POST', '/api/v5/trade/order-algo', {}, body)
    return this.checkAck(rows[0])
  }

  async cancelOrder(instId: string, ids: { clOrdId?: string; ordId?: string }): Promise<void> {
    await this.rest.signed('POST', '/api/v5/trade/cancel-order', {}, { instId, ...ids }).catch((e) => {
      // 51400/51401: order does not exist / already canceled — ignore
      if (!String(e).match(/5140[01]/)) throw e
    })
  }

  async cancelAlgoOrder(instId: string, ids: { algoClOrdId?: string; algoId?: string }): Promise<void> {
    await this.rest.signed('POST', '/api/v5/trade/cancel-algos', {}, [{ instId, ...ids }]).catch((e) => {
      if (!String(e).match(/5140[01]/)) throw e
    })
  }

  async openOrders(instId: string): Promise<OkxOrderEvent[]> {
    return this.rest.signed<OkxOrderEvent>('GET', '/api/v5/trade/orders-pending', { instId })
  }

  async openAlgoOrders(instId: string): Promise<OkxOrderEvent[]> {
    return this.rest.signed<OkxOrderEvent>('GET', '/api/v5/trade/orders-algo-pending', { instId, ordType: 'trigger' })
  }

  private checkAck(ack: OkxOrderAck | undefined): OkxOrderAck {
    if (!ack) throw new Error('OKX: empty order response')
    if (ack.sCode !== '0') throw new Error(`OKX order rejected (sCode ${ack.sCode}): ${ack.sMsg}`)
    return ack
  }
```

Add imports at top of `account.ts`: `import type { OkxOrderAck, OkxOrderEvent } from './types'`.

- [ ] **Step 4: Run test + typecheck**

Run: `bun test packages/data/test/okxAccountOrders.test.ts && bun run --filter '@tpx/data' typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/data/src/okx/account.ts packages/data/test/okxAccountOrders.test.ts
git commit -m "feat(okx): order/algo placement, cancel, open-order reads"
```

---

## Task 9: OKX private WebSocket stream

**Files:**
- Create: `packages/data/src/okx/privateWs.ts`
- Test: `packages/data/test/okxPrivateWs.test.ts`

**Interfaces:**
- Consumes: `okxWsLogin`, `OKX_WS_PRIVATE`, `OKX_WS_PRIVATE_DEMO`, `OkxCredentials`.
- Produces: `subscribeFrames(): object[]` (static helper, testable); `class OkxPrivateStream implements ExchangePrivateStream`.

The socket lifecycle mirrors `BinanceUserStream` (auto-reconnect, ping). Only the **pure frame builders** are unit-tested; the live socket is validated by the manual demo smoke (spec §12).

- [ ] **Step 1: Write the failing test**

```ts
// packages/data/test/okxPrivateWs.test.ts
import { describe, expect, it } from 'bun:test'
import { loginFrame, subscribeFrames } from '../src/okx/privateWs'

describe('okx private ws frames', () => {
  it('builds a login frame', () => {
    const f = loginFrame({ apiKey: 'k', secret: 's', passphrase: 'p' }, Date.parse('2026-06-27T09:08:57.715Z'))
    expect(f.op).toBe('login')
    expect(f.args[0]).toMatchObject({ apiKey: 'k', passphrase: 'p', timestamp: '1782637737' })
  })

  it('subscribes to orders, orders-algo and positions', () => {
    const subs = subscribeFrames()
    const channels = subs.flatMap((s) => (s.args as { channel: string }[]).map((a) => a.channel))
    expect(channels).toEqual(expect.arrayContaining(['orders', 'orders-algo', 'positions']))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/data/test/okxPrivateWs.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `packages/data/src/okx/privateWs.ts`**

```ts
import type { ExchangePrivateStream } from '../exchange/types'
import { OKX_WS_PRIVATE, OKX_WS_PRIVATE_DEMO } from './endpoints'
import { okxWsLogin } from './sign'
import type { OkxCredentials, OkxOrderEvent } from './types'

export function loginFrame(creds: OkxCredentials, now: number): { op: 'login'; args: object[] } {
  return { op: 'login', args: [okxWsLogin(creds.apiKey, creds.secret, creds.passphrase, now)] }
}

export function subscribeFrames(): { op: 'subscribe'; args: { channel: string; instType: string }[] }[] {
  return [
    { op: 'subscribe', args: [{ channel: 'orders', instType: 'ANY' }] },
    { op: 'subscribe', args: [{ channel: 'orders-algo', instType: 'ANY' }] },
    { op: 'subscribe', args: [{ channel: 'positions', instType: 'ANY' }] },
  ]
}

export interface OkxPrivateEvent {
  channel: string
  data: OkxOrderEvent[]
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
    if (this.ping) clearInterval(this.ping)
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
      if (this.ping) clearInterval(this.ping)
      if (!this.stopped) setTimeout(() => this.connect(), this.backoff)
      this.backoff = Math.min(this.backoff * 2, 30_000)
    })
  }

  private onMessage(raw: string): void {
    if (raw === 'pong') return
    let msg: { event?: string; channel?: string; arg?: { channel: string }; data?: OkxOrderEvent[]; code?: string }
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (msg.event === 'login' && msg.code === '0') {
      this.backoff = 1000
      for (const f of subscribeFrames()) this.ws?.send(JSON.stringify(f))
      this.ping = setInterval(() => this.ws?.send('ping'), 25_000)
      return
    }
    if (msg.arg?.channel && msg.data) {
      this.cb?.({ channel: msg.arg.channel, data: msg.data })
    }
  }
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `bun test packages/data/test/okxPrivateWs.test.ts && bun run --filter '@tpx/data' typecheck`
Expected: PASS.

- [ ] **Step 5: Export OKX from the data package**

In `packages/data/src/index.ts`, add the OKX exports next to the existing exports:

```ts
export * from './okx/rest'
export * from './okx/account'
export * from './okx/symbols'
export * from './okx/orders'
export * from './okx/fills'
export * from './okx/privateWs'
export * from './okx/types'
export * from './okx/endpoints'
export * from './okx/sign'
export * from './exchange/types'
```

- [ ] **Step 6: Commit**

```bash
git add packages/data/src/okx/privateWs.ts packages/data/src/index.ts packages/data/test/okxPrivateWs.test.ts
git commit -m "feat(okx): private WS stream (login, subscribe, ping, reconnect) + exports"
```

---

## Task 10: OKXLiveAdapter

**Files:**
- Create: `apps/backend/src/services/okxLiveAdapter.ts`
- Test: `apps/backend/test/okxLiveAdapter.test.ts` (create `apps/backend/test/` if absent)

**Interfaces:**
- Consumes: `ExecutionAdapter`, `OkxAccount`, `buildOrderBody`, `buildAlgoBody`, `mapOrdType`, `mapOkxState`, `parseFill`, `clOrdPrefix`, `makeClOrdId`, `OkxOrderEvent`.
- Produces: `class OKXLiveAdapter implements ExecutionAdapter` with the same construction surface as `BinanceLiveAdapter` (options: `market, demo, symbol, symbolInfo, botId, allocation, leverage, account: OkxAccount, events, getBalances`), plus `handleOrderEvent(ev: OkxOrderEvent)`, `clientIdPrefix`, `setLastPrice`, `snapshot`, `restore`, `reconcile`. Mirror `BinanceLiveAdapter` semantics: virtual slice, OCO emulation, fee normalized to quote.

This is the largest task; split its own test cycle into submit, then fills.

- [ ] **Step 1: Write the failing test (submit + fill)**

```ts
// apps/backend/test/okxLiveAdapter.test.ts
import { describe, expect, it } from 'bun:test'
import type { SymbolInfo } from '@tpx/shared'
import { OKXLiveAdapter } from '../src/services/okxLiveAdapter'

const SI: SymbolInfo = {
  market: 'futures', symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT',
  pricePrecision: 1, qtyPrecision: 3, tickSize: 0.1, stepSize: 0.001, minQty: 0.001,
  minNotional: 5, status: 'TRADING', contractSize: 0.01,
}

function fakeAccount(captured: Record<string, unknown>[]) {
  return {
    placeOrder: async (body: Record<string, unknown>) => { captured.push(body); return { ordId: 'o1', clOrdId: String(body.clOrdId), sCode: '0', sMsg: '' } },
    placeAlgoOrder: async (body: Record<string, unknown>) => { captured.push(body); return { ordId: '', algoId: 'a1', clOrdId: '', algoClOrdId: String(body.algoClOrdId), sCode: '0', sMsg: '' } },
    cancelOrder: async () => {}, cancelAlgoOrder: async () => {},
    openOrders: async () => [], openAlgoOrders: async () => [],
    positions: async () => [], instrument: async () => ({ instId: 'BTC-USDT-SWAP', tickSize: 0.1, stepSize: 1, minQty: 1, contractSize: 0.01, maxLeverage: 125 }),
  } as unknown as import('@tpx/data').OkxAccount
}

function mkAdapter(captured: Record<string, unknown>[]) {
  const fills: unknown[] = []
  const adapter = new OKXLiveAdapter({
    market: 'futures', demo: true, symbol: 'BTCUSDT', symbolInfo: SI, botId: 'bot-123',
    allocation: 1000, leverage: 10, account: fakeAccount(captured),
    events: { onFill: (f) => fills.push(f), onOrderUpdate: () => {} },
    getBalances: () => [],
  })
  adapter.setLastPrice(50000)
  return { adapter, fills }
}

describe('OKXLiveAdapter', () => {
  it('submits a futures market order sized in contracts with an alphanumeric clOrdId', async () => {
    const captured: Record<string, unknown>[] = []
    const { adapter } = mkAdapter(captured)
    const order = await adapter.submit({ side: 'BUY', type: 'MARKET', qty: 0.05 })
    expect(captured[0]).toMatchObject({ instId: 'BTC-USDT-SWAP', ordType: 'market', sz: '5' })
    expect(order.clientId).toMatch(/^tpx[a-z0-9]+$/i)
    expect(order.status).toBe('NEW')
  })

  it('applies a fill from a private order event and emits a normalized fill', async () => {
    const captured: Record<string, unknown>[] = []
    const { adapter, fills } = mkAdapter(captured)
    const order = await adapter.submit({ side: 'BUY', type: 'MARKET', qty: 0.05 })
    adapter.handleOrderEvent({
      instId: 'BTC-USDT-SWAP', clOrdId: order.clientId, ordId: 'o1', state: 'filled', side: 'buy',
      fillSz: '5', fillPx: '50000', fillFee: '-0.025', fillFeeCcy: 'USDT', fillPnl: '0', fillTime: '1782637737000', accFillSz: '5',
    })
    await Promise.resolve() // fee normalization is async
    expect(fills.length).toBe(1)
    expect(adapter.position().qty).toBeCloseTo(0.05, 6)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/backend/test/okxLiveAdapter.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `apps/backend/src/services/okxLiveAdapter.ts`**

Port `BinanceLiveAdapter` (read `apps/backend/src/services/liveAdapter.ts` for the exact position/PnL/OCO/reconcile logic and keep it identical) with these OKX-specific changes:

- Constructor options use `demo: boolean` and `account: OkxAccount`; compute `instId` once via `toInstId(symbolInfo.baseAsset, symbolInfo.quoteAsset, market)` and keep `ctVal = symbolInfo.contractSize ?? 1`, `lotSz = symbolInfo.stepSize`.
- `clientIdPrefix = clOrdPrefix(botId)`; `submit()` builds `clOrdId = makeClOrdId(prefix, ++seq)`.
- `submit()`: `const { algo } = mapOrdType(req.type, market)`. Build body via `buildOrderBody`/`buildAlgoBody` (passing `instId, market, req, clOrdId, ctVal, lotSz, refPrice: this.lastPriceV`). Call `account.placeAlgoOrder` for algo, else `account.placeOrder`. Set `order.exchangeOrderId = ack.ordId || ack.algoId`. Initial status: `isTriggerOrder(req.type) ? 'TRIGGER_PENDING' : 'NEW'`.
- `cancel()`: if `isTriggerOrder(order.type)` → `account.cancelAlgoOrder(instId, { algoClOrdId: order.clientId })`, else `account.cancelOrder(instId, { clOrdId: order.clientId })`.
- `handleOrderEvent(ev)`: look up `this.orders.get(ev.clOrdId)`; update `order.status = mapOkxState(ev.state, order.type, order.executedQty)`; `order.executedQty = Number(ev.accFillSz ?? order.executedQty)`; `const d = parseFill(ev, market, ctVal)`; if `d`, call the spot or futures apply path (reuse Binance `applySpotFill`/`applyFuturesFill` math, but feed `d.lastQty/d.price/d.fee/d.feeCcy/d.pnl/d.maker`). Then `events.onOrderUpdate(order)` and `cancelOcoSiblings` on fill.
- `feeToQuote(amount, ccy, price)`: keep `quote`/base conversion; **remove the BNB branch**. If `ccy === symbolInfo.quoteAsset || ccy === 'USDT'` → amount; if `ccy === symbolInfo.baseAsset` → `amount * price`; else 0.
- `reconcile(resting)`: futures path uses `account.positions(instId, ctVal)`; spot path keeps the resting-order settle logic but reads OKX open orders via `account.openOrders(instId)` and per-order state via a `getOrder`-equivalent (add `OkxAccount.getOrder(instId, { clOrdId })` calling `/api/v5/trade/order` GET if needed; if you don't implement it now, log and skip spot reconcile — note it in the task and the spec §14). For this migration, **futures reconcile via positions is the priority**; spot resting-order catch-up may be a follow-up.

Write the full file now (no placeholders in the committed code). Use the Binance adapter as the literal template for the math.

- [ ] **Step 4: Run test + typecheck**

Run: `bun test apps/backend/test/okxLiveAdapter.test.ts && bun run --filter '@tpx/backend' typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/services/okxLiveAdapter.ts apps/backend/test/okxLiveAdapter.test.ts
git commit -m "feat(backend): OKXLiveAdapter (submit, fills, position/PnL, reconcile)"
```

---

## Task 11: OkxUserStreamRouter

**Files:**
- Modify: `apps/backend/src/services/okxLiveAdapter.ts` (append router)
- Test: `apps/backend/test/okxRouter.test.ts`

**Interfaces:**
- Consumes: `OkxPrivateStream`, `OKXLiveAdapter`, `OkxPrivateEvent`.
- Produces: `class OkxUserStreamRouter` — **one per account** (`live` vs `demo`), routes `orders`/`orders-algo` events to adapters by `clOrdId`/`algoClOrdId` prefix.

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/test/okxRouter.test.ts
import { describe, expect, it } from 'bun:test'
import { OkxUserStreamRouter } from '../src/services/okxLiveAdapter'

describe('OkxUserStreamRouter', () => {
  it('routes an order event to the adapter whose prefix matches', () => {
    const seen: string[] = []
    const adapter = { clientIdPrefix: 'tpxbot123', handleOrderEvent: (ev: { clOrdId: string }) => seen.push(ev.clOrdId) }
    const router = new OkxUserStreamRouter(null as never, () => {})
    router.register(adapter as never)
    router.dispatch({ channel: 'orders', data: [{ instId: 'BTC-USDT-SWAP', clOrdId: 'tpxbot123x', ordId: '1', state: 'filled', side: 'buy' }] })
    expect(seen).toEqual(['tpxbot123x'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/backend/test/okxRouter.test.ts`
Expected: FAIL (export not found).

- [ ] **Step 3: Append `OkxUserStreamRouter` to `okxLiveAdapter.ts`**

```ts
import type { OkxPrivateEvent, OkxPrivateStream } from '@tpx/data'

export class OkxUserStreamRouter {
  private adapters = new Map<string, OKXLiveAdapter>()

  constructor(
    private readonly stream: OkxPrivateStream | null,
    private readonly onError: (e: Error) => void,
  ) {
    this.stream?.onEvent((ev) => this.dispatch(ev))
  }

  async start(): Promise<void> {
    await this.stream?.start()
  }
  stop(): void {
    this.stream?.stop()
  }
  register(a: OKXLiveAdapter): void {
    this.adapters.set(a.clientIdPrefix, a)
  }
  unregister(a: OKXLiveAdapter): void {
    this.adapters.delete(a.clientIdPrefix)
  }
  get size(): number {
    return this.adapters.size
  }

  dispatch(ev: OkxPrivateEvent): void {
    if (ev.channel !== 'orders' && ev.channel !== 'orders-algo') return
    try {
      for (const o of ev.data) {
        const cid = o.clOrdId || (o as { algoClOrdId?: string }).algoClOrdId || ''
        const adapter = this.find(cid)
        adapter?.handleOrderEvent(o)
      }
    } catch (err) {
      this.onError(err instanceof Error ? err : new Error(String(err)))
    }
  }

  private find(clientId: string): OKXLiveAdapter | undefined {
    for (const [prefix, a] of this.adapters) if (clientId.startsWith(prefix)) return a
    return undefined
  }
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `bun test apps/backend/test/okxRouter.test.ts && bun run --filter '@tpx/backend' typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/services/okxLiveAdapter.ts apps/backend/test/okxRouter.test.ts
git commit -m "feat(backend): OkxUserStreamRouter (route private events by clOrdId prefix)"
```

---

## Task 12: Credentials — DB migration + service (passphrase)

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: a Drizzle migration (via `bun run db:generate`)
- Modify: `apps/backend/src/services/credentials.ts`
- Test: `apps/backend/test/credentials.test.ts` (create) — pure encode/shape test using an in-memory stub, OR a focused test of the `OkxCredentials` mapping if the service is hard to unit-test without a DB. If a DB is required, gate the test behind `DATABASE_URL` and otherwise test the crypto round-trip only.

**Interfaces:**
- Produces: `api_credentials.passphrase_enc` (nullable text); `CredentialsService.set(name, apiKey, secret, passphrase)`; `get(name): Promise<OkxCredentials | null>`. Rename type usage `BinanceCredentials` → `OkxCredentials`.

- [ ] **Step 1: Add the column to the schema**

In `packages/db/src/schema.ts`, in `apiCredentials`, add after `secretEnc`:

```ts
  passphraseEnc: text('passphrase_enc'),
```

Update the table comment to `/** AES-256-GCM encrypted OKX credentials (never stored in clear) */`.

- [ ] **Step 2: Generate the migration**

Run: `bun run db:generate`
Expected: a new file under `packages/db/migrations/` adding `passphrase_enc`. Review it adds a **nullable** column (additive, no data loss).

- [ ] **Step 3: Write the failing test (crypto round-trip via the service shape)**

```ts
// apps/backend/test/credentials.test.ts
import { describe, expect, it } from 'bun:test'
import { decryptSecret, encryptSecret } from '../src/crypto'

describe('credentials crypto', () => {
  it('round-trips a passphrase', () => {
    process.env.MASTER_KEY ||= '0'.repeat(64)
    const enc = encryptSecret('my-okx-passphrase')
    expect(decryptSecret(enc)).toBe('my-okx-passphrase')
    expect(enc).not.toContain('my-okx-passphrase')
  })
})
```

- [ ] **Step 4: Run test to verify it passes for crypto, then update the service**

Run: `bun test apps/backend/test/credentials.test.ts`
Expected: PASS (crypto already exists).

Rewrite `apps/backend/src/services/credentials.ts`:

```ts
import { eq } from 'drizzle-orm'
import { apiCredentials, type Db } from '@tpx/db'
import type { OkxCredentials } from '@tpx/data'
import { decryptSecret, encryptSecret } from '../crypto'

export type CredentialsName = 'live' | 'testnet'

export class CredentialsService {
  constructor(private readonly db: Db) {}

  async set(name: CredentialsName, apiKey: string, secret: string, passphrase: string): Promise<void> {
    const row = {
      name,
      apiKeyEnc: encryptSecret(apiKey),
      secretEnc: encryptSecret(secret),
      passphraseEnc: encryptSecret(passphrase),
      updatedAt: Date.now(),
    }
    await this.db
      .insert(apiCredentials)
      .values(row)
      .onConflictDoUpdate({ target: apiCredentials.name, set: row })
  }

  async get(name: CredentialsName): Promise<OkxCredentials | null> {
    const rows = await this.db.select().from(apiCredentials).where(eq(apiCredentials.name, name))
    const r = rows[0]
    if (!r) return null
    return {
      apiKey: decryptSecret(r.apiKeyEnc),
      secret: decryptSecret(r.secretEnc),
      passphrase: r.passphraseEnc ? decryptSecret(r.passphraseEnc) : '',
    }
  }

  async delete(name: CredentialsName): Promise<void> {
    await this.db.delete(apiCredentials).where(eq(apiCredentials.name, name))
  }

  async status(): Promise<Record<CredentialsName, boolean>> {
    const rows = await this.db.select({ name: apiCredentials.name }).from(apiCredentials)
    const names = new Set(rows.map((r) => r.name))
    return { live: names.has('live'), testnet: names.has('testnet') }
  }
}
```

- [ ] **Step 5: Run typecheck**

Run: `bun run --filter '@tpx/db' typecheck && bun run --filter '@tpx/backend' typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema.ts packages/db/migrations apps/backend/src/services/credentials.ts apps/backend/test/credentials.test.ts
git commit -m "feat(credentials): OKX passphrase (DB column + service)"
```

---

## Task 13: Wire OKX into botManager + API

**Files:**
- Modify: `apps/backend/src/services/botManager.ts`
- Modify: `apps/backend/src/api.ts`

**Interfaces:**
- Consumes: `OkxRest`, `OkxAccount`, `OkxPrivateStream`, `OKXLiveAdapter`, `OkxUserStreamRouter`, `CredentialsService.get` (now returns `OkxCredentials`).
- Produces: bots run live on OKX; the credentials API route accepts `passphrase`; a `GET /api/fees/:market/:symbol` (or extend existing) returns `{ maker, taker, level }` from `OkxAccount.tradeFee`.

This task has no new unit test (integration wiring); it is gated by the full suite staying green + the manual demo smoke. Read `botManager.ts` first and replicate the existing Binance wiring shape with OKX types.

- [ ] **Step 1: Replace the live wiring in `botManager.ts`**

Find where `UserStreamRouter` / `BinanceLiveAdapter` / `BinanceAccount` / `BinanceRest` are constructed for live/testnet bots. Replace with:
- Build `OkxRest({ demo, credentials })` from `CredentialsService.get('live'|'testnet')`.
- Build `OkxAccount(rest)`.
- Resolve `instId` and fetch the instrument once; set `symbolInfo.contractSize = instrument.contractSize`, and round tick/step from OKX (`tickSize`, `stepSize`, `minQty`).
- Replace per-`(market,testnet)` routers with **one `OkxUserStreamRouter` per account** (`live`, `demo`). Construct it with `new OkxPrivateStream(creds, demo, onError)`.
- On bot start: `account.setLeverage(instId, leverage, 'isolated')` for futures (replaces `setLeverage` + `setIsolatedMargin`).
- Construct `OKXLiveAdapter({...})`, `router.register(adapter)`, `adapter.reconcile(resting)`.

Keep the data feeds untouched: the bot's candle/trade feed still comes from `liveFeeds.ts` (Binance) and pushes `setLastPrice` into the adapter exactly as before.

- [ ] **Step 2: Update the credentials route in `api.ts`**

Find the `POST /api/credentials/:name` handler. Accept `{ apiKey, secret, passphrase }` and call `credentials.set(name, apiKey, secret, passphrase)`. Add/extend a fee endpoint:

```ts
// GET /api/fees/:name/:market/:symbol -> live OKX maker/taker/level (or null)
app.get('/api/fees/:name/:market/:symbol', async (c) => {
  const creds = await credentials.get(c.req.param('name') as 'live' | 'testnet')
  if (!creds) return c.json(null)
  const rest = new OkxRest({ demo: c.req.param('name') === 'testnet', credentials: creds })
  const acc = new OkxAccount(rest)
  const market = c.req.param('market') as 'spot' | 'futures'
  const si = /* resolve base/quote for the symbol as elsewhere in api.ts */ null
  // build instId from the symbol's base/quote + market (toInstId), then:
  // const fee = await acc.tradeFee(instType(market), instId)
  return c.json(/* fee */ null)
})
```

Fill in the `instId` resolution using the same symbol-info lookup the file already uses for other endpoints (do not invent a new one). Import `toInstId`, `instType` from `@tpx/data`.

- [ ] **Step 3: Run the full suite + typecheck**

Run: `bun test && bun run typecheck`
Expected: PASS (all packages).

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/services/botManager.ts apps/backend/src/api.ts
git commit -m "feat(backend): run bots on OKX (botManager + credentials/fees API)"
```

---

## Task 14: Settings UI (passphrase, demo, OKX fees)

**Files:**
- Modify: `apps/web/src/pages/Settings.tsx`
- Modify: `apps/web/src/lib/api.ts` (or wherever the credentials/fee client calls live)

**Interfaces:**
- Consumes: credentials API (now `passphrase`), `GET /api/fees/...`.
- Produces: a passphrase input, a demo toggle, removal of the BNB balance display, and a maker/taker + tier (`level`) display fed by the fee endpoint, plus an "import my real rates" action that fills backtest fee defaults.

No automated UI test (consistent with the repo). Validate by typecheck + `bun run build` + visual check.

- [ ] **Step 1: Update the credentials client call**

In the API client, change the credentials setter signature to send `{ apiKey, secret, passphrase }`. Add a `getFees(name, market, symbol)` call hitting `/api/fees/:name/:market/:symbol`.

- [ ] **Step 2: Update `Settings.tsx`**

In `CredentialsCard`: add a controlled `passphrase` input (same styling as apiKey/secret), include it in the submit payload. Remove any BNB balance UI. Add a read-only line showing the imported `level` + maker/taker when available. Keep the existing card layout (button bottom-right, equal heights).

In the backtest fee UI (wherever `FeeConfig` is edited): remove the BNB toggle; add a tier `<select>` driven by `FEE_TIER_PRESETS[market]` that sets maker/taker, keep manual override inputs, and add an "Importer mes vrais taux" button calling `getFees` and writing the result into maker/taker.

- [ ] **Step 3: Typecheck + build**

Run: `bun run --filter '@tpx/web' typecheck && bun run build`
Expected: PASS.

- [ ] **Step 4: Visual check**

Run `make web` + `make back` + `make db`, open Settings, confirm: 3 credential fields, demo toggle, no BNB, fee/tier line renders. (Manual.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/Settings.tsx apps/web/src/lib/api.ts
git commit -m "feat(web): OKX credentials (passphrase + demo), fee tier presets + import"
```

---

## Task 15: Remove Binance trading code + docs + final verification

**Files:**
- Delete: `packages/data/src/binance/account.ts`, `apps/backend/src/services/liveAdapter.ts`
- Modify: `packages/data/src/binance/ws.ts` (remove `BinanceUserStream`, keep `BinanceMarketWs`)
- Modify: `packages/data/src/binance/rest.ts` (remove `signed`/`keyed`/`BinanceCredentials` if unused), `packages/data/src/index.ts`
- Modify: `README.md` / `apps/backend/.env.example` comments referencing Binance trading

- [ ] **Step 1: Find remaining references**

Run: `grep -rln "BinanceAccount\|BinanceUserStream\|BinanceLiveAdapter\|BinanceCredentials\|liveAdapter" packages apps --include=*.ts | grep -v okx`
Expected: only the files listed above (and their now-removed imports).

- [ ] **Step 2: Delete dead trading code**

```bash
git rm packages/data/src/binance/account.ts apps/backend/src/services/liveAdapter.ts
```

In `binance/ws.ts`, delete the `BinanceUserStream` class and its listenKey deps (keep `BinanceMarketWs`, `mapWsKline`, `mapWsAggTrade`). In `binance/rest.ts`, if nothing imports `signed`/`keyed`/`BinanceCredentials` anymore (verify with grep), remove them and keep `public()` + the 451 failover + `syncTime`. Update `packages/data/src/index.ts` to stop exporting the removed symbols.

- [ ] **Step 3: Update docs**

Update `MASTER_KEY` comment in `apps/backend/.env.example` from "encrypt Binance API keys" → "encrypt OKX API keys". Update `README.md` trading sections to say execution = OKX (data = Binance). Add a one-line note to `docs/superpowers/specs/2026-06-27-okx-execution-migration-design.md` status: "implemented".

- [ ] **Step 4: Full verification**

Run: `bun test && bun run typecheck && bun run build`
Expected: all green; no references to deleted Binance trading symbols.

Run: `grep -rn "bnbDiscount\|BNB_DISCOUNT" packages apps --include=*.ts`
Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove Binance trading code, keep Binance market data; docs"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** §3 abstraction → Tasks 2,7,8; §4 REST/auth/demo → Tasks 2,3; §5 symbols/contracts → Tasks 4,7; §6 order mapping → Task 5; §7 clOrdId → Task 5; §8 private WS → Task 9; §9 adapter → Tasks 10,11; §10 credentials → Task 12; §11 fees → Task 1 + Task 14 (UI) + Task 13 (live fetch); §2 kept/deleted → Task 15; cutover phases map to task order.
- **Open items deferred (spec §14):** spot resting-order reconcile depends on an OKX `getOrder` helper (noted in Task 10 Step 3 as a possible follow-up); maker flag on fills defaults to taker (Task 6) pending demo confirmation. These are flagged, not silent.
- **Type consistency:** `OkxCredentials` (Task 2) used by Tasks 3,12,13; `ExchangeInstrument`/`ExchangePosition` (Task 2) used by Tasks 7,10; `FillDelta` (Task 6) consumed in Task 10; `buildOrderBody/buildAlgoBody/mapOrdType/mapOkxState` (Task 5) consumed in Task 10; `OkxOrderEvent` (Task 2) consumed in Tasks 6,9,10,11.
