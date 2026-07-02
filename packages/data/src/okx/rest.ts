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
    if (env.code !== '0') {
      // Sur les endpoints trade, l'enveloppe porte souvent code '1' + msg vide et
      // le VRAI code est par-item (data[0].sCode, ex. 51400 « déjà annulé ») —
      // le remonter, sinon les appelants ne peuvent pas tolérer ces cas.
      const item = Array.isArray(env.data)
        ? (env.data[0] as { sCode?: string; sMsg?: string } | undefined)
        : undefined
      const code = item?.sCode && item.sCode !== '0' ? item.sCode : env.code
      const msg = env.msg || item?.sMsg || res.statusText
      throw new OkxApiError(code, res.status, msg)
    }
    return env.data
  }
}
