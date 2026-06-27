import { describe, expect, it } from 'bun:test'
import type { BacktestConfig, Candle, Interval, MarketType, SymbolInfo } from '@tpx/shared'
import { DEFAULT_BACKTEST_VALUES } from '@tpx/shared'
import { defineStrategy } from '../src/strategy/define'
import { p } from '../src/strategy/params'
import { runBacktest } from '../src/engine/backtest'
import type { BacktestDataProvider } from '../src/engine/types'
import { expandGrid } from '../src/optimize/grid'
import { walkForwardWindows } from '../src/optimize/walkforward'

const SI: SymbolInfo = {
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

function mkCandles(n: number): Candle[] {
  const out: Candle[] = []
  for (let i = 0; i < n; i++) {
    const o = 100 + i
    out.push({
      openTime: i * 60_000,
      open: o,
      high: o + 2,
      low: o - 2,
      close: o + 1,
      volume: 1000,
      quoteVolume: 1000 * o,
      trades: 50,
      takerBuyBase: 500,
      takerBuyQuote: 500 * o,
      closeTime: i * 60_000 + 59_999,
    })
  }
  return out
}

class FakeProvider implements BacktestDataProvider {
  constructor(private readonly candles: Candle[]) {}
  async getCandles(_m: MarketType, _s: string, _i: Interval, start: number, end: number): Promise<Candle[]> {
    return this.candles.filter((c) => c.openTime >= start && c.openTime < end)
  }
  async getSymbolInfo(): Promise<SymbolInfo | null> {
    return SI
  }
}

const testStrategy = defineStrategy({
  name: 'bt-test',
  markets: ['spot'],
  params: { interval: p.interval({ default: '1m' }) },
  async onCandle(ctx) {
    const n = ((ctx.state['n'] as number) ?? 0) + 1
    ctx.state['n'] = n
    if (n === 6) {
      await ctx.order.market({ side: 'BUY', quoteQty: 500, reason: 'test entry' })
    }
    if (n === 11 && ctx.position.qty > 0) {
      await ctx.order.market({ side: 'SELL', qty: ctx.position.qty, reason: 'test exit' })
    }
  },
})

function mkConfig(over: Partial<BacktestConfig> = {}): BacktestConfig {
  return {
    strategyId: 'bt-test',
    params: { interval: '1m' },
    market: 'spot',
    symbol: 'TESTUSDT',
    start: 0,
    end: 20 * 60_000,
    ...DEFAULT_BACKTEST_VALUES,
    initialBalance: 1000,
    slippagePct: 0,
    warmupBars: 0,
    fees: { makerRate: 0.001, takerRate: 0.001 },
    ...over,
  }
}

describe('runBacktest', () => {
  it('fills on the candle AFTER the signal, builds the round trip, samples equity per candle', async () => {
    const provider = new FakeProvider(mkCandles(20))
    const result = await runBacktest({ config: mkConfig(), def: testStrategy, provider })

    expect(result.haltedReason).toBeNull()
    expect(result.finalState['n']).toBe(20)
    expect(result.equity.length).toBe(20)

    expect(result.trades.length).toBe(1)
    const t = result.trades[0]!
    expect(t.exitTime).not.toBeNull()
    // signal on candle #5 (n=6) → market fill at candle #6 open = 106
    expect(t.avgEntryPrice).toBeCloseTo(106, 9)
    // exit signal on candle #10 (n=11) → fill at candle #11 open = 111
    expect(t.avgExitPrice!).toBeCloseTo(111, 9)
    expect(t.entryReason).toBe('test entry')
    expect(t.exitReason).toBe('test exit')

    // OKX: taker fee (0.10%) on each leg's notional, no token discount. On the
    // buy the fee shaves the received base, so the exit sells slightly less than
    // was bought — compute against the actual fills rather than a single qty.
    const entryFill = t.fills[0]!
    const exitFill = t.fills.at(-1)!
    const expectedFees = (entryFill.quoteQty + exitFill.quoteQty) * 0.001
    const grossPnl = (exitFill.price - entryFill.price) * exitFill.qty
    expect(t.realizedPnl).toBeCloseTo(grossPnl - expectedFees, 6)

    expect(result.metrics.totalTrades).toBe(1)
    expect(result.metrics.winningTrades).toBe(1)
    // reconciles to the cent: OKX spot fees shave the received base, and lot-size
    // rounding on the exit leaves a sub-cent base remainder marked into equity.
    expect(result.metrics.finalEquity).toBeCloseTo(1000 + t.realizedPnl, 2)
    expect(result.metrics.buyHoldReturnPct).toBeGreaterThan(0)
    expect(result.metrics.exposurePct).toBeGreaterThan(0)
  })

  it('suppresses strategy callbacks during warmup but not indicator updates', async () => {
    const provider = new FakeProvider(mkCandles(40))
    const config = mkConfig({ start: 20 * 60_000, end: 40 * 60_000, warmupBars: 0 })
    const result = await runBacktest({ config, def: testStrategy, provider })
    // only the 20 candles inside [start, end) reach onCandle
    expect(result.finalState['n']).toBe(20)
    expect(result.equity.length).toBe(20)
    expect(result.equity[0]!.time).toBeGreaterThanOrEqual(20 * 60_000)
  })

  it('rejects invalid params and unsupported markets', async () => {
    const provider = new FakeProvider(mkCandles(20))
    expect(
      runBacktest({ config: mkConfig({ market: 'futures' }), def: testStrategy, provider }),
    ).rejects.toThrow(/does not support/)
  })
})

describe('optimizer pieces', () => {
  it('expands cartesian grids over base params', () => {
    const schema = { a: { kind: 'int' as const, default: 1 }, b: { kind: 'select' as const, default: 'x', options: ['x', 'y'] } }
    const combos = expandGrid(schema, { a: 1, b: 'x' }, { a: { from: 1, to: 3, step: 1 }, b: ['x', 'y'] })
    expect(combos.length).toBe(6)
    expect(combos[0]).toEqual({ a: 1, b: 'x' })
    expect(() => expandGrid(schema, {}, { nope: [1] })).toThrow(/unknown param/)
  })

  it('walk-forward windows tile the tail contiguously', () => {
    const w = walkForwardWindows(0, 1000, { windows: 4, isRatio: 0.75 })
    expect(w.length).toBe(4)
    expect(w[0]!.isStart).toBe(0)
    expect(w[0]!.oosStart).toBe(w[0]!.isEnd)
    for (let i = 1; i < w.length; i++) {
      expect(w[i]!.oosStart).toBe(w[i - 1]!.oosEnd)
      expect(w[i]!.isEnd).toBe(w[i]!.oosStart)
    }
    expect(w[3]!.oosEnd).toBe(1000)
  })
})
