import { crossover, defineStrategy, ind, p } from '@tpx/core'

/**
 * Mean reversion: achète quand le RSI ressort d'une zone de survente, avec un
 * filtre de tendance EMA optionnel. Sortie sur reprise du RSI ou stop ATR.
 * Long-only (spot et futures).
 */
export default defineStrategy({
  name: 'RSI Mean Reversion',
  description:
    "Achète la sortie de survente RSI (recroisement au-dessus du seuil) en tendance haussière ; sortie sur RSI haut ou stop ATR.",
  markets: ['spot', 'futures'],
  params: {
    interval: p.interval({ default: '15m', label: 'Unité de temps', group: 'Général' }),
    rsiPeriod: p.int({ default: 14, min: 2, max: 100, label: 'Période RSI', group: 'Entrée' }),
    rsiOversold: p.number({ default: 30, min: 5, max: 50, step: 1, label: 'Seuil de survente', group: 'Entrée' }),
    useTrendFilter: p.bool({ default: true, label: 'Filtre de tendance EMA', group: 'Entrée' }),
    emaTrendPeriod: p.int({ default: 200, min: 20, max: 500, label: 'Période EMA tendance', group: 'Entrée' }),
    rsiExit: p.number({ default: 60, min: 40, max: 95, step: 1, label: 'RSI de sortie', group: 'Sortie' }),
    atrPeriod: p.int({ default: 14, min: 2, max: 100, label: 'Période ATR', group: 'Risque' }),
    atrStopMult: p.number({ default: 2.5, min: 0.5, max: 10, step: 0.1, label: 'Stop = ATR ×', group: 'Risque' }),
    riskPct: p.percent({ default: 1, min: 0.1, max: 10, label: 'Risque par trade', group: 'Risque' }),
  },

  init(ctx) {
    return {
      rsi: ctx.indicator('main', ind.rsi(ctx.params.rsiPeriod)),
      emaTrend: ctx.indicator('main', ind.ema(ctx.params.emaTrendPeriod), { color: '#ff9800' }),
      atr: ctx.indicator('main', ind.atr(ctx.params.atrPeriod), { plot: 'none' }),
    }
  },

  async onCandle(ctx, feedId) {
    if (feedId !== 'main') return
    const { rsi, emaTrend, atr } = ctx.locals
    if (!rsi.ready || !atr.ready || (ctx.params.useTrendFilter && !emaTrend.ready)) return

    const position = ctx.position

    if (position.qty === 0) {
      const uptrend = !ctx.params.useTrendFilter || ctx.price > (emaTrend.value ?? Number.POSITIVE_INFINITY)
      if (uptrend && crossover(rsi, ctx.params.rsiOversold)) {
        const stop = ctx.roundPrice(ctx.price - (atr.value ?? 0) * ctx.params.atrStopMult)
        if (stop <= 0 || stop >= ctx.price) return
        const qty = ctx.risk.sizeByRisk({ entry: ctx.price, stop, riskPct: ctx.params.riskPct })
        if (qty <= 0) return
        const reason =
          `RSI ${rsi.at(1)?.toFixed(1)} → ${rsi.value?.toFixed(1)} recroise ${ctx.params.rsiOversold}` +
          (ctx.params.useTrendFilter ? ` | prix > EMA${ctx.params.emaTrendPeriod}` : '')
        ctx.state['stopPrice'] = stop
        await ctx.order.market({ side: 'BUY', qty, reason, tag: 'entry' })
      }
      return
    }

    // in position: RSI take-profit (the ATR stop rests on the book via onFill)
    if (position.qty > 0 && crossover(rsi, ctx.params.rsiExit)) {
      await ctx.order.cancelAll('sl')
      await ctx.order.market({
        side: 'SELL',
        qty: position.qty,
        reduceOnly: true,
        reason: `RSI ${rsi.value?.toFixed(1)} > ${ctx.params.rsiExit} : prise de profit`,
        tag: 'tp',
      })
    }
  },

  async onFill(ctx, fill, order) {
    // pose le stop de protection dès que l'entrée est exécutée
    if (order.tag === 'entry' && ctx.position.qty > 0) {
      const stop = (ctx.state['stopPrice'] as number | undefined) ?? 0
      if (stop > 0) {
        ctx.annotate({ type: 'label', time: ctx.time, price: stop, text: 'SL', color: '#f23645' })
        await ctx.order.stopMarket({
          side: 'SELL',
          qty: ctx.position.qty,
          stopPrice: stop,
          reduceOnly: true,
          reason: `Stop ATR ×${ctx.params.atrStopMult}`,
          tag: 'sl',
        })
      }
    }
  },

  async onStop(ctx) {
    await ctx.order.cancelAll()
  },
})
