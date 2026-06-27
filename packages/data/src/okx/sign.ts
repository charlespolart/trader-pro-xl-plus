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
