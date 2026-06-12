import { defineStrategy, ind, p } from '@tpx/core'

/**
 * Breakout de canal de Donchian, long/short, futures uniquement.
 * Entrée à la cassure du canal précédent, stop ATR, sortie au retour sur la
 * médiane du canal. Évite les longs quand le funding est très positif (et
 * inversement) — le portage coûte.
 */
export default defineStrategy({
  name: 'Donchian Breakout (futures)',
  description:
    'Cassure du canal Donchian N périodes avec stop ATR et sortie médiane ; filtre de funding.',
  markets: ['futures'],
  params: {
    interval: p.interval({ default: '4h', label: 'Unité de temps', group: 'Général' }),
    channel: p.int({ default: 20, min: 5, max: 200, label: 'Période du canal', group: 'Entrée' }),
    allowShort: p.bool({ default: true, label: 'Autoriser les shorts', group: 'Entrée' }),
    maxFundingBps: p.number({
      default: 5,
      min: 0,
      max: 50,
      step: 0.5,
      label: 'Funding max toléré (bps/8h)',
      description: 'Bloque les entrées dont le portage est plus coûteux que ce seuil',
      group: 'Entrée',
    }),
    atrPeriod: p.int({ default: 14, min: 2, max: 100, label: 'Période ATR', group: 'Risque' }),
    atrStopMult: p.number({ default: 2, min: 0.5, max: 10, step: 0.1, label: 'Stop = ATR ×', group: 'Risque' }),
    riskPct: p.percent({ default: 1, min: 0.1, max: 10, label: 'Risque par trade', group: 'Risque' }),
  },

  init(ctx) {
    return {
      don: ctx.indicator('main', ind.donchian(ctx.params.channel)),
      atr: ctx.indicator('main', ind.atr(ctx.params.atrPeriod), { plot: 'none' }),
    }
  },

  async onFunding(ctx, _amount, rate) {
    ctx.state['lastFundingBps'] = rate * 10_000
  },

  async onCandle(ctx, feedId, candle) {
    if (feedId !== 'main') return
    const { don, atr } = ctx.locals
    // canal de la bougie PRÉCÉDENTE : casser le canal courant inclurait la bougie elle-même
    const prev = don.at(1)
    if (!prev || !atr.ready) return

    const pos = ctx.position
    const atrV = atr.value ?? 0
    const fundingBps = (ctx.state['lastFundingBps'] as number | undefined) ?? 0

    // ---- exits: retour sur la médiane
    if (pos.qty > 0 && candle.close < prev.middle) {
      await ctx.order.cancelAll('sl')
      await ctx.order.market({
        side: 'SELL',
        qty: pos.qty,
        reduceOnly: true,
        reason: `Clôture sous la médiane Donchian (${prev.middle.toFixed(2)})`,
        tag: 'exit',
      })
      return
    }
    if (pos.qty < 0 && candle.close > prev.middle) {
      await ctx.order.cancelAll('sl')
      await ctx.order.market({
        side: 'BUY',
        qty: -pos.qty,
        reduceOnly: true,
        reason: `Clôture au-dessus de la médiane Donchian (${prev.middle.toFixed(2)})`,
        tag: 'exit',
      })
      return
    }

    if (pos.qty !== 0) return

    // ---- entries: cassure du canal précédent
    if (candle.close > prev.upper && fundingBps <= ctx.params.maxFundingBps) {
      const stop = ctx.roundPrice(candle.close - atrV * ctx.params.atrStopMult)
      const qty = ctx.risk.sizeByRisk({ entry: candle.close, stop, riskPct: ctx.params.riskPct })
      if (qty <= 0) return
      ctx.state['stopPrice'] = stop
      await ctx.order.market({
        side: 'BUY',
        qty,
        reason: `Cassure haussière du canal ${ctx.params.channel} (${prev.upper.toFixed(2)}) | funding ${fundingBps.toFixed(1)} bps`,
        tag: 'entry',
      })
    } else if (ctx.params.allowShort && candle.close < prev.lower && -fundingBps <= ctx.params.maxFundingBps) {
      const stop = ctx.roundPrice(candle.close + atrV * ctx.params.atrStopMult)
      const qty = ctx.risk.sizeByRisk({ entry: candle.close, stop, riskPct: ctx.params.riskPct })
      if (qty <= 0) return
      ctx.state['stopPrice'] = stop
      await ctx.order.market({
        side: 'SELL',
        qty,
        reason: `Cassure baissière du canal ${ctx.params.channel} (${prev.lower.toFixed(2)}) | funding ${fundingBps.toFixed(1)} bps`,
        tag: 'entry',
      })
    }
  },

  async onFill(ctx, _fill, order) {
    if (order.tag !== 'entry' || ctx.position.qty === 0) return
    const stop = (ctx.state['stopPrice'] as number | undefined) ?? 0
    if (stop <= 0) return
    const long = ctx.position.qty > 0
    ctx.annotate({ type: 'label', time: ctx.time, price: stop, text: 'SL', color: '#f23645' })
    await ctx.order.stopMarket({
      side: long ? 'SELL' : 'BUY',
      qty: Math.abs(ctx.position.qty),
      stopPrice: stop,
      reduceOnly: true,
      reason: `Stop ATR ×${ctx.params.atrStopMult}`,
      tag: 'sl',
    })
  },

  async onStop(ctx) {
    await ctx.order.cancelAll()
  },
})
