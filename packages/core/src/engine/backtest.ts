import {
  INTERVAL_MS,
  clamp,
  validateParams,
  type AggTrade,
  type BacktestConfig,
  type Candle,
  type EquityPoint,
  type Fill,
  type FundingEvent,
  type Interval,
} from '@tpx/shared'
import { StrategyRuntime } from '../strategy/runtime'
import type { StrategyDefinition } from '../strategy/types'
import { SimExchange } from './simExchange'
import { TradeBuilder } from './trades'
import { computeMetrics } from './metrics'
import type { BacktestDataProvider, BacktestEngineResult, BacktestProgress } from './types'

export interface RunBacktestOptions {
  config: BacktestConfig
  def: StrategyDefinition
  provider: BacktestDataProvider
  signal?: AbortSignal
  onProgress?(p: BacktestProgress): void
}

interface CandleFeedCursor {
  id: string
  symbol: string
  interval: Interval
  candles: Candle[]
  idx: number
}

/**
 * Event-driven backtest. All data streams (multi-TF candles, aggTrades,
 * funding) are merged chronologically; the sim matches orders against each
 * price event BEFORE the strategy sees it, so the strategy can never act on
 * information that has not "happened" yet.
 */
export async function runBacktest(opts: RunBacktestOptions): Promise<BacktestEngineResult> {
  const { config, def, provider } = opts

  const validation = validateParams(def.schema, config.params)
  if (!validation.ok) {
    throw new Error(`Invalid params for '${def.name}': ${validation.errors.join('; ')}`)
  }
  const params = validation.values
  if (!def.markets.includes(config.market)) {
    throw new Error(`Strategy '${def.name}' does not support the ${config.market} market`)
  }

  const symbolInfo = await provider.getSymbolInfo(config.market, config.symbol)
  const leverage = config.market === 'futures' ? Math.max(1, config.leverage) : 1

  const fillQueue: Fill[] = []
  const orderUpdateQueue: string[] = []
  let liquidation: { price: number; time: number } | null = null

  const baseDenom = config.denomination === 'base'
  if (baseDenom && config.market !== 'spot') {
    throw new Error("La dénomination 'base' (accumulation BTC) n'est supportée qu'en spot")
  }

  const sim = new SimExchange({
    market: config.market,
    symbol: config.symbol,
    symbolInfo,
    initialBalance: config.initialBalance,
    leverage,
    fees: config.fees,
    slippagePct: config.slippagePct,
    intrabarPath: config.intrabarPath,
    limitFillRatio: config.limitFillRatio,
    maintenanceMarginRate: config.maintenanceMarginRate,
    denomination: config.denomination,
    events: {
      onFill: (fill) => fillQueue.push(fill),
      onOrderUpdate: (id) => orderUpdateQueue.push(id),
      onLiquidation: (price, time) => {
        liquidation = { price, time }
      },
    },
  })

  const runtime = new StrategyRuntime({ def, params, mode: 'backtest', exec: sim })
  await runtime.init()

  const warmupBars = Math.max(config.warmupBars, runtime.maxWarmup() + 10)

  // ---- load data
  const feeds = runtime.feedList
  const candleFeeds: CandleFeedCursor[] = []
  for (const f of feeds) {
    if (!f.interval) continue
    const loadStart = config.start - warmupBars * INTERVAL_MS[f.interval]
    const candles = await provider.getCandles(config.market, f.symbol, f.interval, loadStart, config.end)
    candleFeeds.push({ id: f.id, symbol: f.symbol, interval: f.interval, candles, idx: 0 })
  }
  const onSymbol = candleFeeds.filter((f) => f.symbol === config.symbol)
  if (onSymbol.length === 0) throw new Error('No candle feed on the traded symbol')
  const matchFeed = onSymbol.reduce((a, b) => (INTERVAL_MS[a.interval] <= INTERVAL_MS[b.interval] ? a : b))
  const sampleIntervalMs = INTERVAL_MS[matchFeed.interval]

  let funding: FundingEvent[] = []
  if (config.market === 'futures' && config.fundingEnabled && provider.getFundingRates) {
    funding = await provider.getFundingRates(config.symbol, config.start, config.end)
  }
  let fundingIdx = 0

  const tradesFeeds = feeds.filter((f) => f.trades)
  const localTradeFeeds = tradesFeeds.filter((f) => f.symbol === config.symbol)
  for (const f of tradesFeeds) {
    if (f.symbol !== config.symbol) {
      runtime.ctx.warn(`Feed '${f.id}': aggTrades on a different symbol are not replayed in backtests yet`)
    }
  }
  const wantTrades = config.fillMode === 'aggtrades' || localTradeFeeds.length > 0
  let aggIter: AsyncIterator<AggTrade[]> | null = null
  if (wantTrades) {
    if (!provider.getAggTrades) {
      if (config.fillMode === 'aggtrades') {
        throw new Error('fillMode=aggtrades requires aggTrades data (provider does not support it)')
      }
      runtime.ctx.warn('aggTrades feed requested but unavailable; onTrade will not fire in this backtest')
    } else {
      aggIter = provider
        .getAggTrades(config.market, config.symbol, config.start, config.end)
        [Symbol.asyncIterator]()
    }
  }
  let aggBuf: AggTrade[] = []
  let aggIdx = 0
  let aggDone = aggIter === null

  const tradeBuilder = new TradeBuilder(config.market, config.symbol, leverage, {}, baseDenom)

  // ---- run state
  const equity: EquityPoint[] = []
  let equityPeak = -Infinity
  let exposureSamples = 0
  let totalSamples = 0
  let firstPrice = 0
  let lastSamplePrice = 0
  let processed = 0
  let strategyError: string | null = null

  const deliverEvents = async (suppress: boolean): Promise<void> => {
    while (fillQueue.length > 0) {
      const fill = fillQueue.shift()!
      tradeBuilder.onFill(fill)
      if (!suppress && fill.orderId !== 'liquidation') {
        const order = sim.getOrder(fill.orderId)
        if (order) {
          try {
            await runtime.handleFill(fill, order)
          } catch (err) {
            strategyError = `onFill: ${err instanceof Error ? err.message : String(err)}`
          }
        }
      }
    }
    while (orderUpdateQueue.length > 0) {
      const id = orderUpdateQueue.shift()!
      if (suppress) continue
      const order = sim.getOrder(id)
      if (order) {
        try {
          await runtime.handleOrderUpdate(order)
        } catch (err) {
          strategyError = `onOrderUpdate: ${err instanceof Error ? err.message : String(err)}`
        }
      }
    }
    if (liquidation) {
      const liq = liquidation as { price: number; time: number }
      runtime.ctx.annotate({
        type: 'marker',
        time: liq.time,
        position: 'inBar',
        shape: 'circle',
        color: '#f23645',
        text: `LIQUIDATION @ ${liq.price.toPrecision(6)}`,
      })
      runtime.ctx.warn(`Position liquidated at ${liq.price}`)
      liquidation = null
    }
  }

  // ---- merged event loop
  const span = Math.max(1, config.end - config.start)
  loop: while (strategyError === null && runtime.halted === null) {
    if (opts.signal?.aborted) throw new Error('Backtest canceled')

    // refill the aggTrades buffer if needed
    while (aggIter && !aggDone && aggIdx >= aggBuf.length) {
      const n = await aggIter.next()
      if (n.done) {
        aggDone = true
      } else {
        aggBuf = n.value
        aggIdx = 0
      }
    }

    // pick the earliest event; ties: funding < trades < candles (asc interval)
    let kind: 'none' | 'funding' | 'trade' | 'candle' = 'none'
    let evTime = Infinity
    let evSub = Infinity
    let evFeed: CandleFeedCursor | null = null

    const fEv = funding[fundingIdx]
    if (fEv && (fEv.time < evTime || (fEv.time === evTime && 0 < evSub))) {
      kind = 'funding'
      evTime = fEv.time
      evSub = 0
    }
    const tEv = !aggDone ? aggBuf[aggIdx] : undefined
    if (tEv && (tEv.time < evTime || (tEv.time === evTime && 1 < evSub))) {
      kind = 'trade'
      evTime = tEv.time
      evSub = 1
    }
    for (const f of candleFeeds) {
      const c = f.candles[f.idx]
      if (!c) continue
      const sub = 2 + INTERVAL_MS[f.interval] / INTERVAL_MS['1s']
      if (c.closeTime < evTime || (c.closeTime === evTime && sub < evSub)) {
        kind = 'candle'
        evTime = c.closeTime
        evSub = sub
        evFeed = f
      }
    }

    switch (kind) {
      case 'none':
        break loop
      case 'funding': {
        sim.setTime(fEv!.time)
        const amount = sim.applyFunding(fEv!.rate)
        if (amount !== 0) {
          tradeBuilder.onFunding(amount)
          if (fEv!.time >= config.start) {
            try {
              await runtime.handleFunding(amount, fEv!.rate)
            } catch (err) {
              strategyError = `onFunding: ${err instanceof Error ? err.message : String(err)}`
            }
          }
        }
        fundingIdx++
        break
      }
      case 'trade': {
        const trade = tEv!
        const suppress = trade.time < config.start
        sim.setTime(trade.time)
        if (config.fillMode === 'aggtrades') {
          sim.processAggTrade(trade.price, trade.qty)
        } else {
          sim.setLastPrice(trade.price)
        }
        await deliverEvents(suppress)
        for (const tf of localTradeFeeds) {
          try {
            await runtime.handleTrade(tf.id, trade, suppress)
          } catch (err) {
            strategyError = `onTrade: ${err instanceof Error ? err.message : String(err)}`
            break
          }
        }
        aggIdx++
        break
      }
      case 'candle': {
        const feed = evFeed!
        const candle = feed.candles[feed.idx]!
        const isMatch = feed === matchFeed
        const suppress = candle.closeTime < config.start
        sim.setTime(candle.closeTime)
        if (isMatch) {
          if (config.fillMode === 'candle') {
            sim.processCandle(candle)
          } else {
            sim.setLastPrice(candle.close)
          }
          await deliverEvents(suppress)
          tradeBuilder.onCandle(candle)
        }
        try {
          await runtime.handleCandle(feed.id, candle, suppress)
        } catch (err) {
          strategyError = `onCandle: ${err instanceof Error ? err.message : String(err)}`
        }
        if (isMatch && !suppress) {
          const eq = sim.equity()
          if (firstPrice === 0) firstPrice = candle.close
          lastSamplePrice = candle.close
          equityPeak = Math.max(equityPeak, eq)
          equity.push({
            time: candle.closeTime,
            equity: eq,
            drawdownPct: equityPeak > 0 ? ((equityPeak - eq) / equityPeak) * 100 : 0,
          })
          totalSamples++
          // exposition = part du temps « en trade ». En base-denom, être en
          // trade = avoir vendu son BTC (posQty == 0, on est en USDT) ; sinon
          // = avoir une position ouverte.
          const inMarket = baseDenom ? sim.position().qty === 0 : sim.position().qty !== 0
          if (inMarket) exposureSamples++
        }
        feed.idx++
        break
      }
    }

    processed++
    if (processed % 8192 === 0) {
      opts.onProgress?.({
        ratio: clamp((evTime - config.start) / span, 0, 1),
        processedEvents: processed,
        currentTime: evTime,
      })
    }
  }

  if (strategyError !== null) {
    runtime.ctx.warn(`Strategy error halted the backtest: ${strategyError}`)
  }
  try {
    await runtime.stop()
  } catch (err) {
    runtime.ctx.warn(`onStop failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  const trades = tradeBuilder.finalize()
  const metrics = computeMetrics({
    start: config.start,
    end: config.end,
    initialBalance: config.initialBalance,
    equity,
    trades,
    sampleIntervalMs,
    // base-denom : frais cumulés convertis en BTC (approx. au dernier prix)
    totalFees: baseDenom && lastSamplePrice > 0 ? sim.totalFees / lastSamplePrice : sim.totalFees,
    totalFunding: sim.totalFunding,
    exposureRatio: totalSamples > 0 ? exposureSamples / totalSamples : 0,
    firstPrice,
    lastPrice: lastSamplePrice,
    baseDenominated: baseDenom,
  })

  opts.onProgress?.({ ratio: 1, processedEvents: processed, currentTime: config.end })

  return {
    config,
    metrics,
    trades,
    equity,
    annotations: runtime.collectAnnotations(),
    logs: runtime.collectLogs(),
    indicators: runtime.collectIndicatorSeries(),
    finalState: runtime.getState(),
    haltedReason: strategyError ?? runtime.halted,
  }
}
