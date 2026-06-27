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
