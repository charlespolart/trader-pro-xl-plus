import { defineStrategy, ind, p } from '@tpx/core'
import { emaCross } from './_indicators'

/**
 * EMA Cross avec filtres de confirmation (RSI momentum, ADX force de
 * tendance). Entrée au croisement confirmé, bracket SL (ATR) + TP (multiple
 * du risque) en OCO, sortie anticipée sur croisement inverse.
 *
 * Les croisements REJETÉS par un filtre sont annotés sur la chart — on voit
 * exactement pourquoi le bot n'a pas pris un signal.
 */
export default defineStrategy({
  name: 'EMA Cross + Filtres (RSI/ADX)',
  description:
    'Croisement EMA rapide/lente confirmé par RSI et ADX, stop ATR + take profit en multiple du risque (OCO).',
  markets: ['spot', 'futures'],

  params: {
    interval: p.interval({ default: '1h', label: 'Unité de temps', group: 'Général' }),
    allowShort: p.bool({ default: false, label: 'Autoriser les shorts (futures)', group: 'Général' }),

    emaFast: p.int({ default: 12, min: 2, max: 100, label: 'EMA rapide', group: 'Croisement' }),
    emaSlow: p.int({ default: 50, min: 5, max: 400, label: 'EMA lente', group: 'Croisement' }),

    useRsiFilter: p.bool({ default: true, label: 'Filtre RSI', group: 'Filtres' }),
    rsiPeriod: p.int({ default: 14, min: 2, max: 100, label: 'Période RSI', group: 'Filtres' }),
    rsiMinLong: p.number({
      default: 52,
      min: 30,
      max: 70,
      step: 1,
      label: 'RSI min pour un long',
      description: 'Le croisement haussier doit être appuyé par le momentum',
      group: 'Filtres',
    }),
    rsiMaxShort: p.number({ default: 48, min: 30, max: 70, step: 1, label: 'RSI max pour un short', group: 'Filtres' }),

    useAdxFilter: p.bool({ default: false, label: 'Filtre ADX', group: 'Filtres' }),
    adxPeriod: p.int({ default: 14, min: 5, max: 50, label: 'Période ADX', group: 'Filtres' }),
    adxMin: p.number({ default: 20, min: 10, max: 50, step: 1, label: 'ADX minimum', group: 'Filtres' }),

    atrPeriod: p.int({ default: 14, min: 2, max: 100, label: 'Période ATR', group: 'Risque' }),
    atrStopMult: p.number({ default: 2, min: 0.5, max: 10, step: 0.1, label: 'Stop = ATR ×', group: 'Risque' }),
    tpRMultiple: p.number({
      default: 2,
      min: 0.5,
      max: 10,
      step: 0.1,
      label: 'Take profit (× risque)',
      description: 'TP placé à N fois la distance entrée→stop',
      group: 'Risque',
    }),
    riskPct: p.percent({ default: 1, min: 0.1, max: 10, label: 'Risque par trade', group: 'Risque' }),
  },

  init(ctx) {
    return {
      cross: ctx.indicator('main', emaCross(ctx.params.emaFast, ctx.params.emaSlow)),
      rsi: ctx.indicator('main', ind.rsi(ctx.params.rsiPeriod), {
        plot: ctx.params.useRsiFilter ? 'pane' : 'none',
      }),
      adx: ctx.indicator('main', ind.adx(ctx.params.adxPeriod), {
        plot: ctx.params.useAdxFilter ? 'pane' : 'none',
      }),
      atr: ctx.indicator('main', ind.atr(ctx.params.atrPeriod), { plot: 'none' }),
    }
  },

  async onCandle(ctx, feedId, candle) {
    if (feedId !== 'main') return
    const { cross, rsi, adx, atr } = ctx.locals
    if (!cross.ready || !atr.ready) return
    if (ctx.params.useRsiFilter && !rsi.ready) return
    if (ctx.params.useAdxFilter && !adx.ready) return

    const signal = cross.value!.cross
    const pos = ctx.position

    // ---- sortie anticipée : croisement inverse pendant qu'on est en position
    if (pos.qty > 0 && signal === -1) {
      await ctx.order.cancelAll()
      await ctx.order.market({
        side: 'SELL',
        qty: pos.qty,
        reduceOnly: true,
        reason: `Croisement inverse EMA${ctx.params.emaFast}/${ctx.params.emaSlow} : sortie anticipée`,
        tag: 'exit',
      })
      return
    }
    if (pos.qty < 0 && signal === 1) {
      await ctx.order.cancelAll()
      await ctx.order.market({
        side: 'BUY',
        qty: -pos.qty,
        reduceOnly: true,
        reason: `Croisement inverse EMA${ctx.params.emaFast}/${ctx.params.emaSlow} : sortie anticipée`,
        tag: 'exit',
      })
      return
    }

    if (pos.qty !== 0 || signal === 0) return

    // ---- filtres de confirmation
    const rsiV = rsi.value ?? 50
    const adxV = adx.value?.adx ?? 0
    const wantLong = signal === 1
    const wantShort = signal === -1 && ctx.market === 'futures' && ctx.params.allowShort
    if (signal === -1 && !wantShort) return

    const rejections: string[] = []
    if (ctx.params.useRsiFilter) {
      if (wantLong && rsiV < ctx.params.rsiMinLong) {
        rejections.push(`RSI ${rsiV.toFixed(1)} < ${ctx.params.rsiMinLong}`)
      }
      if (wantShort && rsiV > ctx.params.rsiMaxShort) {
        rejections.push(`RSI ${rsiV.toFixed(1)} > ${ctx.params.rsiMaxShort}`)
      }
    }
    if (ctx.params.useAdxFilter && adxV < ctx.params.adxMin) {
      rejections.push(`ADX ${adxV.toFixed(1)} < ${ctx.params.adxMin}`)
    }

    if (rejections.length > 0) {
      // signal ignoré — on le matérialise sur la chart pour comprendre le bot
      ctx.annotate({
        type: 'marker',
        time: candle.openTime,
        position: wantLong ? 'below' : 'above',
        shape: 'circle',
        color: '#787b86',
        text: `signal ${wantLong ? 'long' : 'short'} rejeté: ${rejections.join(', ')}`,
      })
      ctx.debug(`Croisement ${wantLong ? 'haussier' : 'baissier'} ignoré (${rejections.join(', ')})`)
      return
    }

    // ---- entrée
    const atrV = atr.value ?? 0
    const dir = wantLong ? 1 : -1
    const stop = ctx.roundPrice(candle.close - dir * atrV * ctx.params.atrStopMult)
    const riskDist = Math.abs(candle.close - stop)
    if (riskDist <= 0) return
    const tp = ctx.roundPrice(candle.close + dir * riskDist * ctx.params.tpRMultiple)
    const qty = ctx.risk.sizeByRisk({ entry: candle.close, stop, riskPct: ctx.params.riskPct })
    if (qty <= 0) return

    ctx.state['stopPrice'] = stop
    ctx.state['tpPrice'] = tp
    ctx.state['bracketSet'] = false

    const filters = [
      ctx.params.useRsiFilter ? `RSI ${rsiV.toFixed(1)} ${wantLong ? '≥' : '≤'} ${wantLong ? ctx.params.rsiMinLong : ctx.params.rsiMaxShort}` : null,
      ctx.params.useAdxFilter ? `ADX ${adxV.toFixed(1)} ≥ ${ctx.params.adxMin}` : null,
    ]
      .filter(Boolean)
      .join(', ')
    await ctx.order.market({
      side: wantLong ? 'BUY' : 'SELL',
      qty,
      reason:
        `EMA${ctx.params.emaFast} croise EMA${ctx.params.emaSlow} ${wantLong ? 'à la hausse' : 'à la baisse'}` +
        (filters ? ` | ${filters}` : '') +
        ` | SL ${stop} / TP ${tp}`,
      tag: 'entry',
    })
  },

  async onFill(ctx, _fill, order) {
    // bracket SL/TP posé une seule fois, dès que l'entrée commence à s'exécuter
    if (order.tag === 'entry' && ctx.position.qty !== 0 && ctx.state['bracketSet'] !== true) {
      ctx.state['bracketSet'] = true
      const long = ctx.position.qty > 0
      const qty = Math.abs(ctx.position.qty)
      const stop = ctx.state['stopPrice'] as number
      const tp = ctx.state['tpPrice'] as number
      ctx.annotate({ type: 'label', time: ctx.time, price: stop, text: 'SL', color: '#f23645' })
      ctx.annotate({ type: 'label', time: ctx.time, price: tp, text: 'TP', color: '#26a69a' })
      await ctx.order.stopMarket({
        side: long ? 'SELL' : 'BUY',
        qty,
        stopPrice: stop,
        reduceOnly: true,
        ocoGroup: 'exit',
        reason: `Stop ATR ×${ctx.params.atrStopMult}`,
        tag: 'sl',
      })
      await ctx.order.takeProfitMarket({
        side: long ? 'SELL' : 'BUY',
        qty,
        stopPrice: tp,
        reduceOnly: true,
        ocoGroup: 'exit',
        reason: `Take profit ${ctx.params.tpRMultiple}R`,
        tag: 'tp',
      })
    }
    // position refermée (SL/TP/exit) → prêt pour le prochain signal
    if ((order.tag === 'sl' || order.tag === 'tp' || order.tag === 'exit') && ctx.position.qty === 0) {
      ctx.state['bracketSet'] = false
    }
  },

  async onStop(ctx) {
    await ctx.order.cancelAll()
  },
})
