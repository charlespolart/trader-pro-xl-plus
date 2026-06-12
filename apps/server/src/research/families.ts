/**
 * Familles de stratégies candidates pour la recherche d'edge sur BTC.
 * Toutes : long ET short selon le régime HTF (1d), sizing par risque,
 * brackets SL/TP en OCO. Les variantes sont volontairement peu nombreuses
 * au round 1 — on cherche une BASE qui respire, pas un pic d'optimisation.
 */
import { crossover, crossunder, defineStrategy, ind, p, type StrategyDefinition } from '@tpx/core'
import type { ParamValues } from '@tpx/shared'

export interface Family {
  key: string
  def: StrategyDefinition
  variants: { label: string; params: ParamValues }[]
}

// ------------------------------------------------------------ shared bits

/* eslint-disable @typescript-eslint/no-explicit-any */

async function placeBracket(ctx: any): Promise<void> {
  if (ctx.position.qty === 0 || ctx.state['bracket'] === true) return
  ctx.state['bracket'] = true
  const long = ctx.position.qty > 0
  const qty = Math.abs(ctx.position.qty)
  const stop = ctx.state['stop'] as number
  const tp = ctx.state['tp'] as number
  if (stop > 0) {
    await ctx.order.stopMarket({ side: long ? 'SELL' : 'BUY', qty, stopPrice: stop, reduceOnly: true, ocoGroup: 'exit', tag: 'sl', reason: 'SL' })
  }
  if (tp > 0) {
    await ctx.order.takeProfitMarket({ side: long ? 'SELL' : 'BUY', qty, stopPrice: tp, reduceOnly: true, ocoGroup: 'exit', tag: 'tp', reason: 'TP' })
  }
}

const sharedOnFill = async (ctx: any, _fill: any, order: any): Promise<void> => {
  if (order.tag === 'entry') await placeBracket(ctx)
  if ((order.tag === 'sl' || order.tag === 'tp' || order.tag === 'exit') && ctx.position.qty === 0) {
    ctx.state['bracket'] = false
  }
}

const sharedOnStop = async (ctx: any): Promise<void> => {
  await ctx.order.cancelAll()
}

async function enter(ctx: any, side: 'BUY' | 'SELL', stop: number, tp: number | null, riskPct: number, reason: string): Promise<void> {
  const entry = ctx.price
  if (Math.abs(entry - stop) <= 0) return
  const qty = ctx.risk.sizeByRisk({ entry, stop, riskPct })
  if (qty <= 0) return
  ctx.state['stop'] = ctx.roundPrice(stop)
  ctx.state['tp'] = tp !== null ? ctx.roundPrice(tp) : 0
  ctx.state['bracket'] = false
  await ctx.order.market({ side, qty, reason, tag: 'entry' })
}

async function closeAll(ctx: any, reason: string): Promise<void> {
  const q = ctx.position.qty
  if (q === 0) return
  await ctx.order.cancelAll()
  await ctx.order.market({ side: q > 0 ? 'SELL' : 'BUY', qty: Math.abs(q), reduceOnly: true, reason, tag: 'exit' })
}

function htfTrend(ctx: any): 'up' | 'down' | 'flat' {
  const e = ctx.locals.htfEma?.value as number | null
  const c = ctx.feed('htf').candles.close(0) as number | null
  if (e === null || e === undefined || c === null) return 'flat'
  return c > e ? 'up' : c < e ? 'down' : 'flat'
}

const baseParams = {
  interval: p.interval({ default: '4h' }),
  riskPct: p.percent({ default: 1, min: 0.1, max: 5 }),
  useHtf: p.bool({ default: true, label: 'Filtre tendance 1d (EMA200)' }),
  allowShort: p.bool({ default: true }),
}

const htfData = (params: ParamValues) => ({
  main: { interval: params['interval'] as never },
  htf: { interval: '1d' as const },
})

// =================================================================== A
const donchianTrend = defineStrategy({
  name: 'R&D Donchian Trend',
  markets: ['futures'],
  params: {
    ...baseParams,
    channel: p.int({ default: 30, min: 5, max: 200 }),
    atrMult: p.number({ default: 2, min: 0.5, max: 6 }),
    tpR: p.number({ default: 0, min: 0, max: 10, description: '0 = sortie médiane du canal' }),
  },
  data: htfData,
  init(ctx) {
    return {
      don: ctx.indicator('main', ind.donchian(ctx.params.channel), { plot: 'none' }),
      atr: ctx.indicator('main', ind.atr(14), { plot: 'none' }),
      htfEma: ctx.indicator('htf', ind.ema(200), { plot: 'none' }),
    }
  },
  async onCandle(ctx, feedId, c) {
    if (feedId !== 'main') return
    const { don, atr } = ctx.locals
    const prev = don.at(1)
    if (!prev || !atr.ready) return
    const trend = ctx.params.useHtf ? htfTrend(ctx) : 'flat'
    const pos = ctx.position.qty

    if (ctx.params.tpR === 0) {
      if (pos > 0 && c.close < prev.middle) return closeAll(ctx, 'médiane')
      if (pos < 0 && c.close > prev.middle) return closeAll(ctx, 'médiane')
    }
    if (pos !== 0) return

    const a = atr.value ?? 0
    if (c.close > prev.upper && (!ctx.params.useHtf || trend === 'up')) {
      const stop = c.close - ctx.params.atrMult * a
      await enter(ctx, 'BUY', stop, ctx.params.tpR > 0 ? c.close + ctx.params.tpR * (c.close - stop) : null, ctx.params.riskPct, 'breakout haut')
    } else if (ctx.params.allowShort && c.close < prev.lower && (!ctx.params.useHtf || trend === 'down')) {
      const stop = c.close + ctx.params.atrMult * a
      await enter(ctx, 'SELL', stop, ctx.params.tpR > 0 ? c.close - ctx.params.tpR * (stop - c.close) : null, ctx.params.riskPct, 'breakout bas')
    }
  },
  onFill: sharedOnFill,
  onStop: sharedOnStop,
})

// =================================================================== B
const emaCross = defineStrategy({
  name: 'R&D EMA Cross',
  markets: ['futures'],
  params: {
    ...baseParams,
    fast: p.int({ default: 12, min: 2, max: 100 }),
    slow: p.int({ default: 50, min: 10, max: 400 }),
    atrMult: p.number({ default: 2, min: 0.5, max: 6 }),
    tpR: p.number({ default: 2, min: 0, max: 10 }),
  },
  data: htfData,
  init(ctx) {
    return {
      fast: ctx.indicator('main', ind.ema(ctx.params.fast), { plot: 'none' }),
      slow: ctx.indicator('main', ind.ema(ctx.params.slow), { plot: 'none' }),
      atr: ctx.indicator('main', ind.atr(14), { plot: 'none' }),
      htfEma: ctx.indicator('htf', ind.ema(200), { plot: 'none' }),
    }
  },
  async onCandle(ctx, feedId, c) {
    if (feedId !== 'main') return
    const { fast, slow, atr } = ctx.locals
    if (!fast.ready || !slow.ready || !atr.ready) return
    const trend = htfTrend(ctx)
    const pos = ctx.position.qty
    const up = crossover(fast, slow)
    const down = crossunder(fast, slow)
    if (pos > 0 && down) return closeAll(ctx, 'croisement inverse')
    if (pos < 0 && up) return closeAll(ctx, 'croisement inverse')
    if (pos !== 0) return
    const a = atr.value ?? 0
    if (up && (!ctx.params.useHtf || trend === 'up')) {
      const stop = c.close - ctx.params.atrMult * a
      await enter(ctx, 'BUY', stop, ctx.params.tpR > 0 ? c.close + ctx.params.tpR * (c.close - stop) : null, ctx.params.riskPct, 'cross up')
    } else if (ctx.params.allowShort && down && (!ctx.params.useHtf || trend === 'down')) {
      const stop = c.close + ctx.params.atrMult * a
      await enter(ctx, 'SELL', stop, ctx.params.tpR > 0 ? c.close - ctx.params.tpR * (stop - c.close) : null, ctx.params.riskPct, 'cross down')
    }
  },
  onFill: sharedOnFill,
  onStop: sharedOnStop,
})

// =================================================================== C
const rsiPullback = defineStrategy({
  name: 'R&D RSI Pullback',
  markets: ['futures'],
  params: {
    ...baseParams,
    interval: p.interval({ default: '1h' }),
    rsiLen: p.int({ default: 3, min: 2, max: 14 }),
    buyTh: p.number({ default: 15, min: 2, max: 40 }),
    longExit: p.number({ default: 65, min: 50, max: 95 }),
    shortTh: p.number({ default: 85, min: 60, max: 98 }),
    shortExit: p.number({ default: 35, min: 5, max: 50 }),
    atrMult: p.number({ default: 2.5, min: 0.5, max: 6 }),
  },
  data: htfData,
  init(ctx) {
    return {
      rsi: ctx.indicator('main', ind.rsi(ctx.params.rsiLen), { plot: 'none' }),
      atr: ctx.indicator('main', ind.atr(14), { plot: 'none' }),
      htfEma: ctx.indicator('htf', ind.ema(200), { plot: 'none' }),
    }
  },
  async onCandle(ctx, feedId, c) {
    if (feedId !== 'main') return
    const { rsi, atr } = ctx.locals
    if (!rsi.ready || !atr.ready) return
    const r = rsi.value!
    const trend = htfTrend(ctx)
    const pos = ctx.position.qty
    if (pos > 0 && r > ctx.params.longExit) return closeAll(ctx, `rsi ${r.toFixed(0)}`)
    if (pos < 0 && r < ctx.params.shortExit) return closeAll(ctx, `rsi ${r.toFixed(0)}`)
    if (pos !== 0) return
    const a = atr.value ?? 0
    if ((!ctx.params.useHtf || trend === 'up') && r < ctx.params.buyTh) {
      await enter(ctx, 'BUY', c.close - ctx.params.atrMult * a, null, ctx.params.riskPct, `rsi ${r.toFixed(0)}`)
    } else if (ctx.params.allowShort && (!ctx.params.useHtf || trend === 'down') && r > ctx.params.shortTh) {
      await enter(ctx, 'SELL', c.close + ctx.params.atrMult * a, null, ctx.params.riskPct, `rsi ${r.toFixed(0)}`)
    }
  },
  onFill: sharedOnFill,
  onStop: sharedOnStop,
})

// =================================================================== D
const bbMeanRev = defineStrategy({
  name: 'R&D Bollinger MeanRev',
  markets: ['futures'],
  params: {
    ...baseParams,
    period: p.int({ default: 20, min: 10, max: 60 }),
    mult: p.number({ default: 2, min: 1, max: 4 }),
    atrMult: p.number({ default: 2.5, min: 0.5, max: 6 }),
  },
  data: htfData,
  init(ctx) {
    return {
      bb: ctx.indicator('main', ind.bbands(ctx.params.period, ctx.params.mult), { plot: 'none' }),
      atr: ctx.indicator('main', ind.atr(14), { plot: 'none' }),
      htfEma: ctx.indicator('htf', ind.ema(200), { plot: 'none' }),
    }
  },
  async onCandle(ctx, feedId, c) {
    if (feedId !== 'main') return
    const { bb, atr } = ctx.locals
    const b = bb.value
    if (!b || !atr.ready) return
    const trend = htfTrend(ctx)
    const pos = ctx.position.qty
    if (pos > 0 && c.close >= b.middle) return closeAll(ctx, 'médiane BB')
    if (pos < 0 && c.close <= b.middle) return closeAll(ctx, 'médiane BB')
    if (pos !== 0) return
    const a = atr.value ?? 0
    if ((!ctx.params.useHtf || trend === 'up') && c.close < b.lower) {
      await enter(ctx, 'BUY', c.close - ctx.params.atrMult * a, null, ctx.params.riskPct, 'bande basse')
    } else if (ctx.params.allowShort && (!ctx.params.useHtf || trend === 'down') && c.close > b.upper) {
      await enter(ctx, 'SELL', c.close + ctx.params.atrMult * a, null, ctx.params.riskPct, 'bande haute')
    }
  },
  onFill: sharedOnFill,
  onStop: sharedOnStop,
})

// =================================================================== E
const keltnerBreak = defineStrategy({
  name: 'R&D Keltner Breakout',
  markets: ['futures'],
  params: {
    ...baseParams,
    adxMin: p.number({ default: 20, min: 0, max: 50 }),
    useSqueeze: p.bool({ default: false, description: 'exiger une compression BB/KC récente' }),
    atrMult: p.number({ default: 2, min: 0.5, max: 6 }),
  },
  data: htfData,
  init(ctx) {
    return {
      kc: ctx.indicator('main', ind.keltner(20, 2, 10), { plot: 'none' }),
      adx: ctx.indicator('main', ind.adx(14), { plot: 'none' }),
      sq: ctx.indicator('main', ind.squeezeRatio(20, 2, 1.5, 10), { plot: 'none' }),
      atr: ctx.indicator('main', ind.atr(14), { plot: 'none' }),
      htfEma: ctx.indicator('htf', ind.ema(200), { plot: 'none' }),
    }
  },
  async onCandle(ctx, feedId, c) {
    if (feedId !== 'main') return
    const { kc, adx, sq, atr } = ctx.locals
    const k = kc.value
    if (!k || !adx.ready || !atr.ready) return
    const trend = htfTrend(ctx)
    const pos = ctx.position.qty
    if (pos > 0 && c.close < k.middle) return closeAll(ctx, 'médiane KC')
    if (pos < 0 && c.close > k.middle) return closeAll(ctx, 'médiane KC')
    if (pos !== 0) return
    if ((adx.value?.adx ?? 0) < ctx.params.adxMin) return
    if (ctx.params.useSqueeze) {
      // compression dans les 10 dernières bougies
      let squeezed = false
      for (let i = 1; i <= 10; i++) {
        const s = sq.at(i)
        if (s !== null && s < 1) squeezed = true
      }
      if (!squeezed) return
    }
    const a = atr.value ?? 0
    if ((!ctx.params.useHtf || trend === 'up') && c.close > k.upper) {
      await enter(ctx, 'BUY', c.close - ctx.params.atrMult * a, null, ctx.params.riskPct, 'KC break up')
    } else if (ctx.params.allowShort && (!ctx.params.useHtf || trend === 'down') && c.close < k.lower) {
      await enter(ctx, 'SELL', c.close + ctx.params.atrMult * a, null, ctx.params.riskPct, 'KC break down')
    }
  },
  onFill: sharedOnFill,
  onStop: sharedOnStop,
})

// =================================================================== F
const fibRetrace = defineStrategy({
  name: 'R&D Fibonacci Retrace',
  markets: ['futures'],
  params: {
    ...baseParams,
    swing: p.int({ default: 55, min: 20, max: 200 }),
    minImpulsePct: p.number({ default: 6, min: 1, max: 30 }),
    fibFrom: p.number({ default: 0.5, min: 0.3, max: 0.7 }),
    fibTo: p.number({ default: 0.618, min: 0.5, max: 0.8 }),
    fibStop: p.number({ default: 0.8, min: 0.65, max: 1 }),
    rsiMax: p.number({ default: 45, min: 20, max: 70 }),
  },
  data: htfData,
  init(ctx) {
    return {
      rsi: ctx.indicator('main', ind.rsi(14), { plot: 'none' }),
      htfEma: ctx.indicator('htf', ind.ema(200), { plot: 'none' }),
    }
  },
  async onCandle(ctx, feedId, c) {
    if (feedId !== 'main') return
    const { rsi } = ctx.locals
    if (!rsi.ready || ctx.position.qty !== 0) return
    const trend = htfTrend(ctx)
    const hh = ctx.candles.highestHigh(ctx.params.swing)
    const ll = ctx.candles.lowestLow(ctx.params.swing)
    if (hh === null || ll === null) return
    const range = hh - ll
    if ((range / c.close) * 100 < ctx.params.minImpulsePct) return
    const r = rsi.value!

    if ((!ctx.params.useHtf || trend === 'up') && r < ctx.params.rsiMax) {
      // retracement d'une impulsion haussière : zone [HH - fibTo·r, HH - fibFrom·r]
      const zHigh = hh - ctx.params.fibFrom * range
      const zLow = hh - ctx.params.fibTo * range
      if (c.close <= zHigh && c.close >= zLow) {
        await enter(ctx, 'BUY', hh - ctx.params.fibStop * range, hh, ctx.params.riskPct, `fib ${ctx.params.fibFrom}-${ctx.params.fibTo}`)
        return
      }
    }
    if (ctx.params.allowShort && (!ctx.params.useHtf || trend === 'down') && r > 100 - ctx.params.rsiMax) {
      const zLow = ll + ctx.params.fibFrom * range
      const zHigh = ll + ctx.params.fibTo * range
      if (c.close >= zLow && c.close <= zHigh) {
        await enter(ctx, 'SELL', ll + ctx.params.fibStop * range, ll, ctx.params.riskPct, `fib short`)
      }
    }
  },
  onFill: sharedOnFill,
  onStop: sharedOnStop,
})

// =================================================================== G
const flowPullback = defineStrategy({
  name: 'R&D Taker-Flow Pullback',
  markets: ['futures'],
  params: {
    ...baseParams,
    emaLen: p.int({ default: 20, min: 5, max: 100 }),
    flowLen: p.int({ default: 10, min: 2, max: 50 }),
    flowTh: p.number({ default: 0.54, min: 0.5, max: 0.7, step: 0.01 }),
    atrMult: p.number({ default: 1.5, min: 0.5, max: 6 }),
    tpR: p.number({ default: 2, min: 0.5, max: 10 }),
  },
  data: htfData,
  init(ctx) {
    return {
      ema: ctx.indicator('main', ind.ema(ctx.params.emaLen), { plot: 'none' }),
      flow: ctx.indicator('main', ind.takerFlow(ctx.params.flowLen), { plot: 'none' }),
      atr: ctx.indicator('main', ind.atr(14), { plot: 'none' }),
      htfEma: ctx.indicator('htf', ind.ema(200), { plot: 'none' }),
    }
  },
  async onCandle(ctx, feedId, c) {
    if (feedId !== 'main') return
    const { ema, flow, atr } = ctx.locals
    if (!ema.ready || !flow.ready || !atr.ready || ctx.position.qty !== 0) return
    const trend = htfTrend(ctx)
    const f = flow.value!
    const a = atr.value ?? 0
    // prix en pullback sous/sur l'EMA mais le flux taker soutient le sens du
    // régime → les agressifs absorbent la correction
    if ((!ctx.params.useHtf || trend === 'up') && c.close < (ema.value ?? 0) && f > ctx.params.flowTh) {
      const stop = c.close - ctx.params.atrMult * a
      await enter(ctx, 'BUY', stop, c.close + ctx.params.tpR * (c.close - stop), ctx.params.riskPct, `flow ${f.toFixed(2)}`)
    } else if (ctx.params.allowShort && (!ctx.params.useHtf || trend === 'down') && c.close > (ema.value ?? 0) && f < 1 - ctx.params.flowTh) {
      const stop = c.close + ctx.params.atrMult * a
      await enter(ctx, 'SELL', stop, c.close - ctx.params.tpR * (stop - c.close), ctx.params.riskPct, `flow ${f.toFixed(2)}`)
    }
  },
  onFill: sharedOnFill,
  onStop: sharedOnStop,
})

// =================================================================== H
const erTrend = defineStrategy({
  name: 'R&D Efficiency Trend',
  markets: ['futures'],
  params: {
    ...baseParams,
    erLen: p.int({ default: 20, min: 5, max: 60 }),
    erMin: p.number({ default: 0.35, min: 0.1, max: 0.8, step: 0.05 }),
    emaLen: p.int({ default: 50, min: 10, max: 200 }),
    atrMult: p.number({ default: 2.5, min: 0.5, max: 6 }),
    exitMode: p.select({ options: ['ema', 'chandelier'], default: 'ema' }),
    chandMult: p.number({ default: 3, min: 1, max: 6 }),
    useFlowFilter: p.bool({ default: false, description: 'takerFlow doit soutenir le sens' }),
    flowTh: p.number({ default: 0.5, min: 0.45, max: 0.6, step: 0.01 }),
  },
  data: htfData,
  init(ctx) {
    return {
      er: ctx.indicator('main', ind.efficiencyRatio(ctx.params.erLen), { plot: 'none' }),
      ema: ctx.indicator('main', ind.ema(ctx.params.emaLen), { plot: 'none' }),
      atr: ctx.indicator('main', ind.atr(14), { plot: 'none' }),
      flow: ctx.indicator('main', ind.takerFlow(10), { plot: 'none' }),
      htfEma: ctx.indicator('htf', ind.ema(200), { plot: 'none' }),
    }
  },
  async onCandle(ctx, feedId, c) {
    if (feedId !== 'main') return
    const { er, ema, atr, flow } = ctx.locals
    if (!er.ready || !ema.ready || !atr.ready) return
    const trend = htfTrend(ctx)
    const pos = ctx.position.qty
    const e = ema.value!
    const a = atr.value ?? 0

    if (pos !== 0) {
      if (ctx.params.exitMode === 'ema') {
        if (pos > 0 && c.close < e) return closeAll(ctx, 'sous EMA')
        if (pos < 0 && c.close > e) return closeAll(ctx, 'sur EMA')
      } else {
        // chandelier : trailing ATR sur l'extrême depuis l'entrée
        if (pos > 0) {
          const hh = Math.max((ctx.state['hh'] as number) ?? c.high, c.high)
          ctx.state['hh'] = hh
          if (c.close < hh - ctx.params.chandMult * a) return closeAll(ctx, 'chandelier')
        } else {
          const ll = Math.min((ctx.state['ll'] as number) ?? c.low, c.low)
          ctx.state['ll'] = ll
          if (c.close > ll + ctx.params.chandMult * a) return closeAll(ctx, 'chandelier')
        }
      }
      return
    }

    if (er.value! < ctx.params.erMin) return
    const f = flow.value ?? 0.5
    if ((!ctx.params.useHtf || trend === 'up') && c.close > e) {
      if (ctx.params.useFlowFilter && f < ctx.params.flowTh) return
      ctx.state['hh'] = c.high
      await enter(ctx, 'BUY', c.close - ctx.params.atrMult * a, null, ctx.params.riskPct, `ER ${er.value!.toFixed(2)}`)
    } else if (ctx.params.allowShort && (!ctx.params.useHtf || trend === 'down') && c.close < e) {
      if (ctx.params.useFlowFilter && f > 1 - ctx.params.flowTh) return
      ctx.state['ll'] = c.low
      await enter(ctx, 'SELL', c.close + ctx.params.atrMult * a, null, ctx.params.riskPct, `ER ${er.value!.toFixed(2)}`)
    }
  },
  onFill: sharedOnFill,
  onStop: sharedOnStop,
})

// ------------------------------------------------------------------ export

export const FAMILIES: Family[] = [
  {
    key: 'donchian',
    def: donchianTrend,
    variants: [
      { label: 'don30-med', params: {} },
      { label: 'don55-med', params: { channel: 55 } },
      { label: 'don30-tp3R', params: { tpR: 3 } },
      { label: 'don55-noHtf', params: { channel: 55, useHtf: false } },
    ],
  },
  {
    key: 'emacross',
    def: emaCross,
    variants: [
      { label: 'ema12/50', params: {} },
      { label: 'ema21/100', params: { fast: 21, slow: 100 } },
      { label: 'ema12/50-noTp', params: { tpR: 0 } },
    ],
  },
  {
    key: 'rsipull',
    def: rsiPullback,
    variants: [
      { label: 'rsi3-1h', params: {} },
      { label: 'rsi2-1h', params: { rsiLen: 2, buyTh: 10, shortTh: 90 } },
      { label: 'rsi3-4h', params: { interval: '4h' } },
      { label: 'rsi3-1h-longonly', params: { allowShort: false } },
    ],
  },
  {
    key: 'bbrev',
    def: bbMeanRev,
    variants: [
      { label: 'bb20/2', params: {} },
      { label: 'bb20/2.5-1h', params: { mult: 2.5, interval: '1h' } },
    ],
  },
  {
    key: 'keltner',
    def: keltnerBreak,
    variants: [
      { label: 'kc-adx20', params: {} },
      { label: 'kc-adx25-squeeze', params: { adxMin: 25, useSqueeze: true } },
    ],
  },
  {
    key: 'fib',
    def: fibRetrace,
    variants: [
      { label: 'fib50-618', params: {} },
      { label: 'fib-swing89', params: { swing: 89, minImpulsePct: 10 } },
    ],
  },
  {
    key: 'flow',
    def: flowPullback,
    variants: [
      { label: 'flow.54-4h', params: {} },
      { label: 'flow.57-4h', params: { flowTh: 0.57 } },
      { label: 'flow.54-1h', params: { interval: '1h' } },
    ],
  },
  {
    key: 'ertrend',
    def: erTrend,
    variants: [
      { label: 'er.35-ema50', params: {} },
      { label: 'er.45-ema100', params: { erMin: 0.45, emaLen: 100 } },
      { label: 'er-chandelier', params: { exitMode: 'chandelier' } },
      { label: 'er-flowfilter', params: { useFlowFilter: true, flowTh: 0.5 } },
      { label: 'er-noHtf', params: { useHtf: false } },
      { label: 'er-1h', params: { interval: '1h' } },
      // ---- candidat final (centre de plateau) + voisins de contrôle
      { label: 'CANDIDAT', params: { erLen: 20, erMin: 0.35, emaLen: 100, atrMult: 2.5, useFlowFilter: true, flowTh: 0.5 } },
      { label: 'cand-flow.52', params: { erLen: 20, erMin: 0.35, emaLen: 100, atrMult: 2.5, useFlowFilter: true, flowTh: 0.52 } },
      { label: 'cand-ema50', params: { erLen: 20, erMin: 0.35, emaLen: 50, atrMult: 2.5, useFlowFilter: true, flowTh: 0.5 } },
      { label: 'cand-er.45', params: { erLen: 20, erMin: 0.45, emaLen: 100, atrMult: 2.5, useFlowFilter: true, flowTh: 0.5 } },
      { label: 'cand-erLen30', params: { erLen: 30, erMin: 0.35, emaLen: 100, atrMult: 2.5, useFlowFilter: true, flowTh: 0.5 } },
    ],
  },
]
