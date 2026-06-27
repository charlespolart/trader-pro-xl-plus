import { describe, expect, it } from 'bun:test'
import type { Candle, SymbolInfo } from '@tpx/shared'
import { SimExchange } from '../src/engine/simExchange'

const SI: SymbolInfo = {
  market: 'spot',
  symbol: 'BTCUSDT',
  baseAsset: 'BTC',
  quoteAsset: 'USDT',
  pricePrecision: 2,
  qtyPrecision: 6,
  tickSize: 0.01,
  stepSize: 0.000001,
  minQty: 0.000001,
  minNotional: 5,
  status: 'TRADING',
}

function candle(i: number, price: number): Candle {
  const t = i * 3_600_000
  return {
    openTime: t,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: 1000,
    quoteVolume: 1000 * price,
    trades: 100,
    takerBuyBase: 500,
    takerBuyQuote: 500 * price,
    closeTime: t + 3_599_999,
  }
}

function mkSim(feeRate = 0.001) {
  return new SimExchange({
    market: 'spot',
    symbol: 'BTCUSDT',
    symbolInfo: SI,
    initialBalance: 1, // 1 BTC
    leverage: 1,
    fees: { makerRate: feeRate, takerRate: feeRate },
    slippagePct: 0,
    intrabarPath: 'heuristic',
    limitFillRatio: 1,
    maintenanceMarginRate: 0.005,
    denomination: 'base',
  })
}

describe('SimExchange — dénomination BASE (accumulation BTC)', () => {
  it('démarre en détenant le BTC : équité = 1 BTC quel que soit le prix', () => {
    const sim = mkSim()
    sim.setTime(0)
    sim.processCandle(candle(0, 100_000))
    expect(sim.isBaseDenominated).toBe(true)
    expect(sim.equity()).toBeCloseTo(1, 9) // 1 BTC
    expect(sim.position().qty).toBeCloseTo(1, 9) // on détient 1 BTC
    sim.processCandle(candle(1, 50_000)) // le prix s'effondre
    expect(sim.equity()).toBeCloseTo(1, 9) // toujours 1 BTC (on n'a rien fait)
  })

  it('vendre haut puis racheter bas accumule du BTC (sans frais)', async () => {
    const sim = mkSim(0)
    sim.setTime(0)
    sim.processCandle(candle(0, 100_000))
    // vendre 1 BTC
    await sim.submit({ side: 'SELL', type: 'MARKET', qty: 1 })
    sim.processCandle(candle(1, 100_000)) // fill à 100k
    expect(sim.position().qty).toBeCloseTo(0, 9) // en USDT
    expect(sim.equity()).toBeCloseTo(1, 9) // toujours 1 BTC de valeur

    // le prix tombe à 80k, on rachète tout
    await sim.submit({ side: 'BUY', type: 'MARKET', quoteQty: 100_000 })
    sim.processCandle(candle(2, 80_000)) // fill à 80k
    // 100k USDT / 80k = 1.25 BTC
    expect(sim.equity()).toBeCloseTo(1.25, 6)
    expect(sim.position().qty).toBeCloseTo(1.25, 6) // on détient maintenant 1.25 BTC
  })

  it('vendre puis racheter PLUS HAUT perd du BTC (cas perdant)', async () => {
    const sim = mkSim(0)
    sim.setTime(0)
    sim.processCandle(candle(0, 100_000))
    await sim.submit({ side: 'SELL', type: 'MARKET', qty: 1 })
    sim.processCandle(candle(1, 100_000))
    await sim.submit({ side: 'BUY', type: 'MARKET', quoteQty: 100_000 })
    sim.processCandle(candle(2, 125_000)) // le prix est monté → on s'est trompé
    // 100k / 125k = 0.8 BTC
    expect(sim.equity()).toBeCloseTo(0.8, 6)
  })

  it('les frais rognent légèrement le BTC accumulé', async () => {
    const sim = mkSim(0.001)
    sim.setTime(0)
    sim.processCandle(candle(0, 100_000))
    await sim.submit({ side: 'SELL', type: 'MARKET', qty: 1 })
    sim.processCandle(candle(1, 100_000)) // reçoit 99 900 USDT
    await sim.submit({ side: 'BUY', type: 'MARKET', quoteQty: 99_900 })
    sim.processCandle(candle(2, 80_000)) // 99900/80000 = 1.248750, −0.1% = 1.2475
    expect(sim.equity()).toBeCloseTo(1.2475, 4)
    expect(sim.equity()).toBeGreaterThan(1) // toujours gagnant malgré les frais
  })

  it("refuse la dénomination base hors spot", () => {
    expect(
      () =>
        new SimExchange({
          market: 'futures',
          symbol: 'BTCUSDT',
          symbolInfo: SI,
          initialBalance: 1,
          leverage: 1,
          fees: { makerRate: 0, takerRate: 0 },
          slippagePct: 0,
          intrabarPath: 'heuristic',
          limitFillRatio: 1,
          maintenanceMarginRate: 0.005,
          denomination: 'base',
        }),
    ).toThrow(/spot/)
  })
})
