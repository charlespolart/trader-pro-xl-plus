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
