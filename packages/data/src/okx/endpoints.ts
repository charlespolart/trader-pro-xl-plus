// OKX has region-specific hosts. EU accounts (registered on my.okx.com) MUST
// use the `eea.okx.com` / `wseea*.okx.com` hosts — the global www/ws hosts
// reject their keys (50119 / 60032). Select via OKX_REGION (global | eea).

interface OkxHosts {
  rest: string
  wsPublic: string
  wsPrivate: string
  wsPublicDemo: string
  wsPrivateDemo: string
}

const HOSTS: Record<'global' | 'eea', OkxHosts> = {
  global: {
    rest: 'https://www.okx.com',
    wsPublic: 'wss://ws.okx.com:8443/ws/v5/public',
    wsPrivate: 'wss://ws.okx.com:8443/ws/v5/private',
    wsPublicDemo: 'wss://wspap.okx.com:8443/ws/v5/public',
    wsPrivateDemo: 'wss://wspap.okx.com:8443/ws/v5/private',
  },
  eea: {
    rest: 'https://eea.okx.com',
    wsPublic: 'wss://wseea.okx.com:8443/ws/v5/public',
    wsPrivate: 'wss://wseea.okx.com:8443/ws/v5/private',
    wsPublicDemo: 'wss://wseeapap.okx.com:8443/ws/v5/public',
    wsPrivateDemo: 'wss://wseeapap.okx.com:8443/ws/v5/private',
  },
}

function hosts(): OkxHosts {
  return (process.env.OKX_REGION ?? 'global').toLowerCase() === 'eea' ? HOSTS.eea : HOSTS.global
}

export function okxBaseUrl(): string {
  return hosts().rest
}

/** Resolved at call time (NOT import time) so OKX_REGION set late is honored. */
export function okxWsPrivateUrl(demo: boolean): string {
  return demo ? hosts().wsPrivateDemo : hosts().wsPrivate
}

export function okxWsPublicUrl(demo: boolean): string {
  return demo ? hosts().wsPublicDemo : hosts().wsPublic
}

/** Demo trading is the same base URL plus this header (with demo API keys). */
export function demoHeaders(demo: boolean): Record<string, string> {
  return demo ? { 'x-simulated-trading': '1' } : {}
}
