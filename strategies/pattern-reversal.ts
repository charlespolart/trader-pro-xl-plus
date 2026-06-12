import { bullishSignals, candlePatterns, defineStrategy, ind, p } from '@tpx/core'

/**
 * Retournement sur patterns de bougies japonaises : un pattern haussier
 * (hammer, engulfing, morning star…) qui se forme en zone de RSI bas déclenche
 * un long, protégé par un stop sous le plus bas du pattern et un TP en
 * multiple du risque (OCO).
 *
 * Les patterns sont détectés par l'indicateur candlePatterns() du core et
 * s'affichent automatiquement sur la chart (flèches nommées) — pratique pour
 * itérer : on voit chaque détection, tradée ou non.
 */
export default defineStrategy({
  name: 'Pattern Reversal (bougies japonaises)',
  description:
    'Long sur pattern de retournement haussier confirmé par un RSI bas ; stop sous le pattern, TP en multiple du risque.',
  markets: ['spot', 'futures'],

  params: {
    interval: p.interval({ default: '1h', label: 'Unité de temps', group: 'Général' }),

    rsiPeriod: p.int({ default: 14, min: 2, max: 100, label: 'Période RSI', group: 'Filtre' }),
    rsiMax: p.number({
      default: 42,
      min: 20,
      max: 60,
      step: 1,
      label: 'RSI maximum',
      description: 'Le pattern doit se former en zone de faiblesse (RSI sous ce seuil)',
      group: 'Filtre',
    }),
    requireTrend: p.bool({
      default: true,
      label: 'Exiger le contexte de tendance',
      description: 'Définitions classiques : un hammer ne vaut que après une baisse',
      group: 'Filtre',
    }),
    trendMinPct: p.number({ default: 0.8, min: 0.1, max: 5, step: 0.1, label: 'Tendance min (%)', group: 'Filtre' }),

    atrPeriod: p.int({ default: 14, min: 2, max: 100, label: 'Période ATR', group: 'Risque' }),
    stopPadAtr: p.number({ default: 0.25, min: 0, max: 2, step: 0.05, label: 'Marge sous le pattern (× ATR)', group: 'Risque' }),
    tpRMultiple: p.number({ default: 2, min: 0.5, max: 10, step: 0.1, label: 'Take profit (× risque)', group: 'Risque' }),
    riskPct: p.percent({ default: 1, min: 0.1, max: 10, label: 'Risque par trade', group: 'Risque' }),
  },

  init(ctx) {
    return {
      pat: ctx.indicator(
        'main',
        candlePatterns(
          [
            'hammer',
            'invertedHammer',
            'dragonflyDoji',
            'bullishEngulfing',
            'piercingLine',
            'tweezerBottom',
            'bullishHarami',
            'morningStar',
            'threeInsideUp',
            'threeOutsideUp',
            // NB: pas de bullishThreeLineStrike ici — nommage Bulkowski, c'est
            // un pattern de CONTINUATION haussière (3 blanches + strike noir),
            // pas un retournement sur faiblesse
          ],
          { requireTrend: ctx.params.requireTrend, trendMinPct: ctx.params.trendMinPct },
        ),
      ),
      rsi: ctx.indicator('main', ind.rsi(ctx.params.rsiPeriod)),
      atr: ctx.indicator('main', ind.atr(ctx.params.atrPeriod), { plot: 'none' }),
    }
  },

  async onCandle(ctx, feedId, candle) {
    if (feedId !== 'main') return
    const { pat, rsi, atr } = ctx.locals
    if (!pat.ready || !rsi.ready || !atr.ready) return
    if (ctx.position.qty !== 0) return

    const signals = bullishSignals(pat.value)
    if (signals.length === 0) return

    const rsiV = rsi.value ?? 50
    if (rsiV > ctx.params.rsiMax) {
      ctx.debug(`Pattern ${signals.join('+')} ignoré : RSI ${rsiV.toFixed(1)} > ${ctx.params.rsiMax}`)
      return
    }

    // stop sous le plus bas des bougies du pattern (3 dernières bougies max)
    const patternLow = Math.min(
      candle.low,
      ctx.candles.low(1) ?? candle.low,
      ctx.candles.low(2) ?? candle.low,
    )
    const stop = ctx.roundPrice(patternLow - (atr.value ?? 0) * ctx.params.stopPadAtr)
    const riskDist = candle.close - stop
    if (riskDist <= 0) return
    const tp = ctx.roundPrice(candle.close + riskDist * ctx.params.tpRMultiple)
    const qty = ctx.risk.sizeByRisk({ entry: candle.close, stop, riskPct: ctx.params.riskPct })
    if (qty <= 0) return

    ctx.state['stopPrice'] = stop
    ctx.state['tpPrice'] = tp
    ctx.state['bracketSet'] = false
    await ctx.order.market({
      side: 'BUY',
      qty,
      reason: `Pattern ${signals.join(' + ')} | RSI ${rsiV.toFixed(1)} ≤ ${ctx.params.rsiMax} | SL ${stop} / TP ${tp}`,
      tag: 'entry',
    })
  },

  async onFill(ctx, _fill, order) {
    if (order.tag === 'entry' && ctx.position.qty > 0 && ctx.state['bracketSet'] !== true) {
      ctx.state['bracketSet'] = true
      const qty = ctx.position.qty
      const stop = ctx.state['stopPrice'] as number
      const tp = ctx.state['tpPrice'] as number
      ctx.annotate({ type: 'label', time: ctx.time, price: stop, text: 'SL', color: '#f23645' })
      ctx.annotate({ type: 'label', time: ctx.time, price: tp, text: 'TP', color: '#26a69a' })
      await ctx.order.stopMarket({
        side: 'SELL',
        qty,
        stopPrice: stop,
        reduceOnly: true,
        ocoGroup: 'exit',
        reason: 'Stop sous le pattern',
        tag: 'sl',
      })
      await ctx.order.takeProfitMarket({
        side: 'SELL',
        qty,
        stopPrice: tp,
        reduceOnly: true,
        ocoGroup: 'exit',
        reason: `Take profit ${ctx.params.tpRMultiple}R`,
        tag: 'tp',
      })
    }
    if ((order.tag === 'sl' || order.tag === 'tp') && ctx.position.qty === 0) {
      ctx.state['bracketSet'] = false
    }
  },

  async onStop(ctx) {
    await ctx.order.cancelAll()
  },
})
