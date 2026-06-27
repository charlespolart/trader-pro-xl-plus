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
