import { afterEach, describe, expect, it } from 'bun:test'
import { execQuoteAsset, toInstId } from '../src/okx/symbols'

const ORIG = process.env.OKX_REGION
afterEach(() => {
  if (ORIG === undefined) delete process.env.OKX_REGION
  else process.env.OKX_REGION = ORIG
})

describe('execQuoteAsset — EEA maps USDT -> USDC (MiCA Tether restriction)', () => {
  it('passes everything through on the global region', () => {
    delete process.env.OKX_REGION
    expect(execQuoteAsset('USDT')).toBe('USDT')
    expect(execQuoteAsset('USDC')).toBe('USDC')
    expect(execQuoteAsset('USD')).toBe('USD')
  })

  it('maps only USDT -> USDC on eea, leaves other quotes intact', () => {
    process.env.OKX_REGION = 'eea'
    expect(execQuoteAsset('USDT')).toBe('USDC')
    expect(execQuoteAsset('USDC')).toBe('USDC')
    expect(execQuoteAsset('USD')).toBe('USD')
    expect(execQuoteAsset('EUR')).toBe('EUR')
  })

  it('resolves the EEA execution instId to the USDC pair (data stays USDT)', () => {
    process.env.OKX_REGION = 'eea'
    expect(toInstId('BTC', execQuoteAsset('USDT'), 'spot')).toBe('BTC-USDC')
    // no USDC perp exists on OKX -> futures EEA stays "-SWAP" and will fail to list (expected)
    expect(toInstId('BTC', execQuoteAsset('USDT'), 'futures')).toBe('BTC-USDC-SWAP')
  })
})
