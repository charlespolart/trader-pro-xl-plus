import { crossover, crossunder, defineStrategy, ind, p } from '@tpx/core'

/**
 * Suivi de tendance multi-timeframe : croisement d'EMA sur l'unité de travail,
 * filtré par la tendance d'une unité supérieure. Trailing stop ATR géré en
 * continu. Long-only sur spot, long/short sur futures.
 */
export default defineStrategy({
  name: 'EMA Cross Trend (multi-TF)',
  description:
    'Croisement EMA rapide/lente filtré par la tendance du timeframe supérieur, trailing stop ATR.',
  markets: ['spot', 'futures'],
  params: {
    interval: p.interval({ default: '1h', label: 'Unité de temps', group: 'Général' }),
    htfInterval: p.interval({ default: '4h', label: 'Unité supérieure (filtre)', group: 'Général' }),
    emaFast: p.int({ default: 21, min: 2, max: 200, label: 'EMA rapide', group: 'Entrée' }),
    emaSlow: p.int({ default: 55, min: 5, max: 400, label: 'EMA lente', group: 'Entrée' }),
    htfEma: p.int({ default: 50, min: 5, max: 400, label: 'EMA du filtre HTF', group: 'Entrée' }),
    allowShort: p.bool({ default: false, label: 'Autoriser les shorts (futures)', group: 'Entrée' }),
    atrPeriod: p.int({ default: 14, min: 2, max: 100, label: 'Période ATR', group: 'Risque' }),
    trailMult: p.number({ default: 3, min: 0.5, max: 10, step: 0.1, label: 'Trailing = ATR ×', group: 'Risque' }),
    positionPct: p.percent({ default: 25, min: 1, max: 100, label: 'Taille (% du capital)', group: 'Risque' }),
  },

  data: (params) => ({
    main: { interval: params.interval },
    htf: { interval: params.htfInterval },
  }),

  init(ctx) {
    return {
      fast: ctx.indicator('main', ind.ema(ctx.params.emaFast), { color: '#2962ff' }),
      slow: ctx.indicator('main', ind.ema(ctx.params.emaSlow), { color: '#ff6d00' }),
      htfTrend: ctx.indicator('htf', ind.ema(ctx.params.htfEma), { plot: 'none' }),
      atr: ctx.indicator('main', ind.atr(ctx.params.atrPeriod), { plot: 'none' }),
    }
  },

  async onCandle(ctx, feedId, candle) {
    if (feedId !== 'main') return
    const { fast, slow, htfTrend, atr } = ctx.locals
    if (!fast.ready || !slow.ready || !htfTrend.ready || !atr.ready) return

    const pos = ctx.position
    const atrV = atr.value ?? 0
    const htfClose = ctx.feed('htf').candles.close(0) ?? candle.close
    const htfUp = htfClose > (htfTrend.value ?? Number.POSITIVE_INFINITY)
    const htfDown = htfClose < (htfTrend.value ?? 0)
    const canShort = ctx.market === 'futures' && ctx.params.allowShort

    // ---- trailing stop management
    if (pos.qty > 0) {
      const prev = (ctx.state['trail'] as number | undefined) ?? Number.NEGATIVE_INFINITY
      const trail = Math.max(prev, candle.close - atrV * ctx.params.trailMult)
      ctx.state['trail'] = trail
      if (candle.close < trail) {
        await ctx.order.market({
          side: 'SELL',
          qty: pos.qty,
          reduceOnly: true,
          reason: `Trailing stop touché (${trail.toFixed(2)})`,
          tag: 'trail',
        })
        delete ctx.state['trail']
        return
      }
    } else if (pos.qty < 0) {
      const prev = (ctx.state['trail'] as number | undefined) ?? Number.POSITIVE_INFINITY
      const trail = Math.min(prev, candle.close + atrV * ctx.params.trailMult)
      ctx.state['trail'] = trail
      if (candle.close > trail) {
        await ctx.order.market({
          side: 'BUY',
          qty: -pos.qty,
          reduceOnly: true,
          reason: `Trailing stop touché (${trail.toFixed(2)})`,
          tag: 'trail',
        })
        delete ctx.state['trail']
        return
      }
    }

    // ---- entries / reversals
    if (crossover(fast, slow) && htfUp) {
      if (pos.qty < 0) {
        await ctx.order.market({ side: 'BUY', qty: -pos.qty, reduceOnly: true, reason: 'Retournement haussier', tag: 'exit' })
      }
      if (ctx.position.qty === 0) {
        const qty = ctx.risk.sizeByEquityPct(ctx.params.positionPct)
        if (qty > 0) {
          delete ctx.state['trail']
          await ctx.order.market({
            side: 'BUY',
            qty,
            reason: `EMA${ctx.params.emaFast} croise EMA${ctx.params.emaSlow} à la hausse | HTF haussier`,
            tag: 'entry',
          })
        }
      }
    } else if (crossunder(fast, slow)) {
      if (pos.qty > 0) {
        await ctx.order.market({
          side: 'SELL',
          qty: pos.qty,
          reduceOnly: true,
          reason: `EMA${ctx.params.emaFast} croise EMA${ctx.params.emaSlow} à la baisse`,
          tag: 'exit',
        })
        delete ctx.state['trail']
      }
      if (canShort && htfDown && ctx.position.qty === 0) {
        const qty = ctx.risk.sizeByEquityPct(ctx.params.positionPct)
        if (qty > 0) {
          delete ctx.state['trail']
          await ctx.order.market({
            side: 'SELL',
            qty,
            reason: `Croisement baissier | HTF baissier → short`,
            tag: 'entry',
          })
        }
      }
    }
  },

  async onStop(ctx) {
    await ctx.order.cancelAll()
  },
})
