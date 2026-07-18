/**
 * audit1/A2 — runner moteur pour la double implémentation.
 * Deux stratégies-sondes définies ici (une LENTE, une CHURNY), exécutées par
 * le VRAI moteur (runBacktest) sur BTCUSDT spot, symbolInfo ÉPINGLÉ (les
 * arrondis doivent être répliqués à l'identique côté Python).
 * Dump JSON : bougies du feed, fills, équité finale, métriques.
 *   DATABASE_URL=postgres://tpx:tpx@localhost:5438/tpx bun apps/backend/src/research/audit1/engine_run.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineStrategy, ind, p, runBacktest, type BacktestDataProvider } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type SymbolInfo } from '@tpx/shared'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5438/tpx')
const base = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../../data'), autoEnsure: false })

// symbolInfo épinglé (déterminisme total, indépendant d'exchangeInfo)
const PINNED: SymbolInfo = {
  market: 'spot',
  symbol: 'BTCUSDT',
  baseAsset: 'BTC',
  quoteAsset: 'USDT',
  tickSize: 0.01,
  stepSize: 0.00001,
  minQty: 0.00001,
  minNotional: 5,
  pricePrecision: 2,
  qtyPrecision: 8,
  status: 'TRADING',
}
const provider: BacktestDataProvider = {
  getCandles: (m, s, i, a, b) => base.getCandles(m, s, i, a, b),
  getFundingRates: (s, a, b) => base.getFundingRates(s, a, b),
  getSymbolInfo: async () => PINNED,
}

// ---- sonde LENTE : croisement EMA50/200 1d, market only, tout-ou-rien
const slow = defineStrategy({
  name: 'audit-slow',
  description: 'sonde audit : golden cross 1d',
  markets: ['spot'],
  symbol: 'BTCUSDT',
  params: { interval: p.interval({ default: '1d', label: 'tf' }) },
  data: (prm) => ({ main: { interval: prm.interval } }),
  init(ctx) {
    return {
      fast: ctx.indicator('main', ind.ema(50), { plot: 'none' }),
      slowMa: ctx.indicator('main', ind.ema(200), { plot: 'none' }),
    }
  },
  async onCandle(ctx, feedId) {
    if (feedId !== 'main') return
    const { fast, slowMa } = ctx.locals
    if (!fast.ready || !slowMa.ready) return
    const long = fast.value! > slowMa.value!
    const dust = ctx.symbolInfo?.minQty ?? 1e-8
    const holding = ctx.position.qty > dust
    if (long && !holding) {
      const quote = ctx.balances.find((b) => b.asset === 'USDT')
      const usdt = quote ? quote.free : 0
      if (usdt > 10) await ctx.order.market({ side: 'BUY', quoteQty: usdt * 0.999, tag: 'entry' })
    } else if (!long && holding) {
      await ctx.order.market({ side: 'SELL', qty: ctx.position.qty, tag: 'exit' })
    }
  },
})

// ---- sonde CHURNY : Donchian 20 4h + stop ATR (exerce les triggers intrabar)
const churny = defineStrategy({
  name: 'audit-churny',
  description: 'sonde audit : donchian 20 + stop 2×ATR',
  markets: ['spot'],
  symbol: 'BTCUSDT',
  params: { interval: p.interval({ default: '4h', label: 'tf' }) },
  data: (prm) => ({ main: { interval: prm.interval } }),
  init(ctx) {
    return {
      donch: ctx.indicator('main', ind.donchian(20), { plot: 'none' }),
      atr: ctx.indicator('main', ind.atr(14), { plot: 'none' }),
    }
  },
  async onCandle(ctx, feedId, candle) {
    if (feedId !== 'main') return
    const { donch, atr } = ctx.locals
    if (!donch.ready || !atr.ready) return
    const prev = donch.at(1)
    if (!prev) return
    const dust = ctx.symbolInfo?.minQty ?? 1e-8
    const holding = ctx.position.qty > dust
    if (holding) {
      if (candle.close < prev.lower) {
        await ctx.order.cancelAll()
        await ctx.order.market({ side: 'SELL', qty: ctx.position.qty, tag: 'exit' })
      }
      return
    }
    if (candle.close > prev.upper && (atr.value ?? 0) > 0) {
      const quote = ctx.balances.find((b) => b.asset === 'USDT')
      const usdt = quote ? quote.free : 0
      if (usdt <= 10) return
      ctx.state['stop'] = ctx.roundPrice(candle.close - 2 * atr.value!)
      await ctx.order.market({ side: 'BUY', quoteQty: usdt * 0.999, tag: 'entry' })
    }
  },
  async onFill(ctx, _fill, order) {
    const dust = ctx.symbolInfo?.minQty ?? 1e-8
    if (order.tag === 'entry' && ctx.position.qty > dust) {
      const stop = ctx.state['stop'] as number
      if (stop > 0) {
        await ctx.order.stopMarket({ side: 'SELL', qty: ctx.position.qty, stopPrice: stop, tag: 'sl' })
      }
    }
  },
})

const START = Date.parse('2019-01-01T00:00:00Z')
const END = Date.parse('2026-07-01T00:00:00Z')

function cfg(strategyId: string, interval: '1d' | '4h'): BacktestConfig {
  return {
    strategyId,
    params: { interval },
    market: 'spot',
    symbol: 'BTCUSDT',
    start: START,
    end: END,
    initialBalance: 10_000,
    denomination: 'quote',
    leverage: 1,
    fees: { ...DEFAULT_FEES.spot },
    slippagePct: 0.0005,
    fillMode: 'candle',
    intrabarPath: 'heuristic',
    limitFillRatio: 0.25,
    fundingEnabled: false,
    maintenanceMarginRate: 0.005,
    warmupBars: 210,
  }
}

const outDir = resolve(import.meta.dir, 'out')
mkdirSync(outDir, { recursive: true })

for (const [key, def, interval] of [
  ['slow', slow, '1d'],
  ['churny', churny, '4h'],
] as const) {
  const res = await runBacktest({ config: cfg(`audit-${key}`, interval), def, provider })
  // bougies telles que vues par le moteur (warmup inclus) pour le replay Python
  const loadStart = START - 210 * (interval === '1d' ? 86_400_000 : 14_400_000)
  const candles = await provider.getCandles('spot', 'BTCUSDT', interval, loadStart, END)
  const fills = res.trades.flatMap((t) => t.fills).map((f) => ({
    time: f.time, side: f.side, price: f.price, qty: f.qty, fee: f.fee, feeAsset: f.feeAsset, maker: f.maker, orderId: f.orderId, reason: f.reason ?? null, tag: f.tag ?? null,
  }))
  writeFileSync(
    resolve(outDir, `engine_${key}.json`),
    JSON.stringify({
      config: { start: START, end: END, initialBalance: 10_000, fees: DEFAULT_FEES.spot, slippagePct: 0.0005, symbolInfo: PINNED },
      candles: candles.map((c) => [c.openTime, c.open, c.high, c.low, c.close, c.volume, c.closeTime]),
      fills,
      finalEquity: res.metrics.finalEquity,
      netProfitPct: res.metrics.netProfitPct,
      annualizedReturnPct: res.metrics.annualizedReturnPct,
      totalTrades: res.metrics.totalTrades,
      totalFees: res.metrics.totalFees,
      maxDrawdownPct: res.metrics.maxDrawdownPct,
      nEquity: res.equity.length,
    }),
  )
  console.log(
    `${key}: équité finale ${res.metrics.finalEquity.toFixed(2)} (${res.metrics.netProfitPct.toFixed(2)}%), ` +
    `${res.metrics.totalTrades} trades, frais ${res.metrics.totalFees.toFixed(2)}, ${fills.length} fills`,
  )
}
process.exit(0)
