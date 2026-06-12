import { describe, expect, it } from 'bun:test'
import type { Candle, Fill, SymbolInfo } from '@tpx/shared'
import { SimExchange, type SimExchangeOptions } from '../src/engine/simExchange'

const SPOT_SI: SymbolInfo = {
  market: 'spot',
  symbol: 'TESTUSDT',
  baseAsset: 'TEST',
  quoteAsset: 'USDT',
  pricePrecision: 2,
  qtyPrecision: 3,
  tickSize: 0.01,
  stepSize: 0.001,
  minQty: 0.001,
  minNotional: 5,
  status: 'TRADING',
}

function mkCandle(i: number, o: number, h: number, l: number, c: number): Candle {
  const openTime = i * 60_000
  return {
    openTime,
    open: o,
    high: h,
    low: l,
    close: c,
    volume: 1000,
    quoteVolume: 1000 * c,
    trades: 100,
    takerBuyBase: 500,
    takerBuyQuote: 500 * c,
    closeTime: openTime + 59_999,
  }
}

function mkSim(over: Partial<SimExchangeOptions> = {}): { sim: SimExchange; fills: Fill[] } {
  const fills: Fill[] = []
  const sim = new SimExchange({
    market: 'spot',
    symbol: 'TESTUSDT',
    symbolInfo: { ...SPOT_SI, market: over.market ?? 'spot' },
    initialBalance: 1000,
    leverage: 1,
    fees: { makerRate: 0.001, takerRate: 0.001, bnbDiscount: false },
    slippagePct: 0,
    intrabarPath: 'heuristic',
    limitFillRatio: 1,
    maintenanceMarginRate: 0.005,
    events: { onFill: (f) => fills.push(f) },
    ...over,
  })
  return { sim, fills }
}

describe('SimExchange spot', () => {
  it('market orders fill on the NEXT candle open — never the decision candle', async () => {
    const { sim, fills } = mkSim()
    sim.setTime(0)
    sim.processCandle(mkCandle(0, 100, 105, 95, 104)) // decision candle
    await sim.submit({ side: 'BUY', type: 'MARKET', qty: 1 })
    expect(fills.length).toBe(0) // nothing yet
    sim.processCandle(mkCandle(1, 106, 110, 105, 109))
    expect(fills.length).toBe(1)
    expect(fills[0]!.price).toBe(106) // next open, not 104
  })

  it('fees without BNB shave the received asset and position reflects real holdings', async () => {
    const { sim } = mkSim()
    sim.processCandle(mkCandle(0, 100, 100, 100, 100))
    await sim.submit({ side: 'BUY', type: 'MARKET', qty: 1 })
    sim.processCandle(mkCandle(1, 100, 100, 100, 100))
    const base = sim.balances().find((b) => b.asset === 'TEST')!
    expect(base.free).toBeCloseTo(0.999, 9)
    expect(sim.position().qty).toBeCloseTo(0.999, 9)
    const quote = sim.balances().find((b) => b.asset === 'USDT')!
    expect(quote.free).toBeCloseTo(900, 9)
    expect(sim.equity()).toBeCloseTo(900 + 99.9, 6)
  })

  it('fees with BNB keep the base intact and tally the BNB cost', async () => {
    const { sim } = mkSim({ fees: { makerRate: 0.001, takerRate: 0.001, bnbDiscount: true } })
    sim.processCandle(mkCandle(0, 100, 100, 100, 100))
    await sim.submit({ side: 'BUY', type: 'MARKET', qty: 1 })
    sim.processCandle(mkCandle(1, 100, 100, 100, 100))
    expect(sim.position().qty).toBeCloseTo(1, 12)
    // taker 0.1% × (1 − 25%) = 0.075 USDT on a 100 USDT notional
    expect(sim.bnbFeesQuote).toBeCloseTo(0.075, 9)
    const quote = sim.balances().find((b) => b.asset === 'USDT')!
    expect(quote.free).toBeCloseTo(900 - 0.075, 9)
  })

  it('resting limit buys fill as maker when the path touches them, with fund locking', async () => {
    const { sim, fills } = mkSim()
    sim.processCandle(mkCandle(0, 100, 101, 99, 100))
    await sim.submit({ side: 'BUY', type: 'LIMIT', qty: 2, price: 95 })
    const quote = sim.balances().find((b) => b.asset === 'USDT')!
    expect(quote.locked).toBeCloseTo(190, 9)
    sim.processCandle(mkCandle(1, 100, 101, 97, 98)) // low 97 > 95: no fill
    expect(fills.length).toBe(0)
    sim.processCandle(mkCandle(2, 98, 99, 94, 96)) // touches 95
    expect(fills.length).toBe(1)
    expect(fills[0]!.price).toBe(95)
    expect(fills[0]!.maker).toBe(true)
  })

  it('OCO group: the surviving leg cancels its sibling', async () => {
    const { sim, fills } = mkSim()
    sim.processCandle(mkCandle(0, 100, 100, 100, 100))
    await sim.submit({ side: 'BUY', type: 'MARKET', qty: 1 })
    sim.processCandle(mkCandle(1, 100, 100, 100, 100))
    const held = sim.position().qty
    await sim.submit({ side: 'SELL', type: 'STOP_MARKET', qty: held, stopPrice: 90, ocoGroup: 'exit' })
    await sim.submit({ side: 'SELL', type: 'TAKE_PROFIT_MARKET', qty: held, stopPrice: 110, ocoGroup: 'exit' })
    expect(sim.openOrders().length).toBe(2)
    sim.processCandle(mkCandle(2, 105, 112, 104, 111)) // hits the TP on the way up
    const sells = fills.filter((f) => f.side === 'SELL')
    expect(sells.length).toBe(1)
    expect(sells[0]!.price).toBeCloseTo(110, 9)
    expect(sim.openOrders().length).toBe(0) // stop canceled
    expect(sim.position().qty).toBe(0)
  })

  it('rejects spot sells beyond holdings', async () => {
    const { sim } = mkSim()
    sim.processCandle(mkCandle(0, 100, 100, 100, 100))
    expect(sim.submit({ side: 'SELL', type: 'LIMIT', qty: 1, price: 110 })).rejects.toThrow(/Insufficient base/)
  })
})

describe('SimExchange futures', () => {
  const futOpts: Partial<SimExchangeOptions> = {
    market: 'futures',
    leverage: 10,
    fees: { makerRate: 0.0002, takerRate: 0.0005, bnbDiscount: false },
  }

  it('shorts, funding transfers and reduceOnly caps', async () => {
    const { sim } = mkSim(futOpts)
    sim.processCandle(mkCandle(0, 100, 100, 100, 100))
    await sim.submit({ side: 'SELL', type: 'MARKET', qty: 5 })
    sim.processCandle(mkCandle(1, 100, 100, 100, 100))
    expect(sim.position().qty).toBeCloseTo(-5, 9)

    // positive rate: shorts RECEIVE funding
    const amount = sim.applyFunding(0.0001)
    expect(amount).toBeCloseTo(0.0001 * 5 * 100, 9)

    // reduceOnly buy bigger than the position only closes it
    await sim.submit({ side: 'BUY', type: 'MARKET', qty: 50, reduceOnly: true })
    sim.processCandle(mkCandle(2, 100, 100, 100, 100))
    expect(sim.position().qty).toBe(0)
  })

  it('liquidates an over-leveraged long when price crosses the liq level', async () => {
    const { sim, fills } = mkSim({ ...futOpts, initialBalance: 1000 })
    sim.processCandle(mkCandle(0, 10_000, 10_000, 10_000, 10_000))
    await sim.submit({ side: 'BUY', type: 'MARKET', qty: 0.5 }) // 5000 notional, 500 margin
    sim.processCandle(mkCandle(1, 10_000, 10_000, 10_000, 10_000))
    const liq = sim.position().liquidationPrice!
    expect(liq).toBeCloseTo((10_000 * 0.9) / 0.995, 3)

    sim.processCandle(mkCandle(2, 9_500, 9_600, 9_000, 9_100)) // low crosses liq ≈ 9045
    expect(sim.liquidated).toBe(true)
    expect(sim.position().qty).toBe(0)
    expect(sim.openOrders().length).toBe(0)
    const liqFill = fills.find((f) => f.reason === 'liquidation')!
    expect(liqFill.price).toBeCloseTo(liq, 6)
    // margin mostly gone, wallet keeps the maintenance sliver minus fees
    expect(sim.equity()).toBeGreaterThan(505)
    expect(sim.equity()).toBeLessThan(525)
  })

  it('rejects orders whose margin exceeds free balance', async () => {
    const { sim } = mkSim(futOpts)
    sim.processCandle(mkCandle(0, 100, 100, 100, 100))
    // 10x leverage on 1000 → max 100 qty at price 100; ask for 150
    expect(sim.submit({ side: 'BUY', type: 'LIMIT', qty: 150, price: 100 })).rejects.toThrow(/Insufficient margin/)
  })
})
