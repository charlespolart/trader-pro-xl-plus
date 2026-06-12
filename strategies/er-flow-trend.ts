import { defineStrategy, ind, p } from '@tpx/core'

/**
 * ER-Flow Trend — suivi de tendance filtré par efficacité et order-flow.
 *
 * Issue de la campagne de recherche 2026-06 (apps/server/src/research/) :
 *  - régime : prix vs EMA200 1d (long au-dessus, short en dessous)
 *  - qualité de tendance : Efficiency Ratio de Kaufman ≥ seuil (le marché
 *    avance « efficacement », pas du bruit)
 *  - confirmation order-flow : takerFlow > 0.5 dans le sens (les agressifs
 *    soutiennent le mouvement) — indicateur maison sur takerBuyBase
 *  - entrée : clôture du bon côté de l'EMA locale ; stop ATR ; sortie au
 *    re-croisement de l'EMA (les gagnants courent, les perdants coupent)
 *
 * Validation : plateau 54/54 combos PF>1 (IS 2020-2024), PF positif dans les
 * 4 régimes, walk-forward 5/5 fenêtres OOS positives, +44.5% composé OOS
 * 2022-2026 à 1% de risque/trade (B&H dernier segment : -44%).
 * Recommandation : re-fit trimestriel des paramètres via l'optimiseur
 * (walk-forward), risque 1-2%/trade.
 */
export default defineStrategy({
  name: 'ER-Flow Trend',
  description:
    "Suivi de tendance 4h : régime EMA200 1d, Efficiency Ratio (qualité de tendance) + taker-flow (confirmation order-flow), stop ATR, sortie au re-croisement d'EMA. Long-only sur spot.",
  markets: ['spot', 'futures'],

  params: {
    interval: p.interval({ default: '4h', label: 'Unité de temps', group: 'Général' }),
    allowShort: p.bool({ default: true, label: 'Autoriser les shorts', group: 'Général' }),
    useHtf: p.bool({ default: true, label: 'Filtre de régime 1d (EMA200)', group: 'Régime' }),

    erLen: p.int({ default: 20, min: 5, max: 60, label: 'Période Efficiency Ratio', group: 'Tendance' }),
    erMin: p.number({ default: 0.35, min: 0.1, max: 0.8, step: 0.05, label: 'ER minimum', group: 'Tendance' }),
    emaLen: p.int({ default: 50, min: 10, max: 200, label: 'EMA locale', group: 'Tendance' }),

    useFlowFilter: p.bool({ default: true, label: 'Confirmation taker-flow', group: 'Order-flow' }),
    flowLen: p.int({ default: 10, min: 2, max: 50, label: 'Lissage du flux', group: 'Order-flow' }),

    atrPeriod: p.int({ default: 14, min: 2, max: 100, label: 'Période ATR', group: 'Risque' }),
    atrMult: p.number({ default: 2.5, min: 0.5, max: 6, step: 0.1, label: 'Stop = ATR ×', group: 'Risque' }),
    riskPct: p.percent({ default: 1, min: 0.1, max: 5, label: 'Risque par trade', group: 'Risque' }),
  },

  data: (params) => ({
    main: { interval: params.interval },
    htf: { interval: '1d' },
  }),

  init(ctx) {
    return {
      er: ctx.indicator('main', ind.efficiencyRatio(ctx.params.erLen), { plot: 'pane' }),
      ema: ctx.indicator('main', ind.ema(ctx.params.emaLen), { color: '#ff9800' }),
      flow: ctx.indicator('main', ind.takerFlow(ctx.params.flowLen), { plot: 'pane' }),
      atr: ctx.indicator('main', ind.atr(ctx.params.atrPeriod), { plot: 'none' }),
      htfEma: ctx.indicator('htf', ind.ema(200), { plot: 'none' }),
    }
  },

  async onCandle(ctx, feedId, candle) {
    if (feedId !== 'main') return
    const { er, ema, flow, atr, htfEma } = ctx.locals
    if (!er.ready || !ema.ready || !atr.ready || (ctx.params.useFlowFilter && !flow.ready)) return
    if (ctx.params.useHtf && !htfEma.ready) return

    const e = ema.value!
    const pos = ctx.position.qty

    // ---- sortie : re-croisement de l'EMA locale
    if (pos > 0 && candle.close < e) {
      await ctx.order.cancelAll()
      await ctx.order.market({ side: 'SELL', qty: pos, reduceOnly: true, reason: `Clôture sous EMA${ctx.params.emaLen}`, tag: 'exit' })
      return
    }
    if (pos < 0 && candle.close > e) {
      await ctx.order.cancelAll()
      await ctx.order.market({ side: 'BUY', qty: -pos, reduceOnly: true, reason: `Clôture sur EMA${ctx.params.emaLen}`, tag: 'exit' })
      return
    }
    if (pos !== 0) return

    // ---- régime + qualité de tendance + flux
    const htfClose = ctx.feed('htf').candles.close(0)
    const trendUp = !ctx.params.useHtf || (htfClose !== null && htfClose > (htfEma.value ?? Number.POSITIVE_INFINITY))
    const trendDown = !ctx.params.useHtf || (htfClose !== null && htfClose < (htfEma.value ?? 0))
    const erV = er.value!
    if (erV < ctx.params.erMin) return
    const f = flow.value ?? 0.5
    const a = atr.value ?? 0
    if (a <= 0) return

    if (trendUp && candle.close > e && (!ctx.params.useFlowFilter || f > 0.5)) {
      const stop = ctx.roundPrice(candle.close - ctx.params.atrMult * a)
      const qty = ctx.risk.sizeByRisk({ entry: candle.close, stop, riskPct: ctx.params.riskPct })
      if (qty <= 0) return
      ctx.state['stop'] = stop
      ctx.state['bracket'] = false
      await ctx.order.market({
        side: 'BUY',
        qty,
        reason: `Régime 1d haussier | ER ${erV.toFixed(2)} ≥ ${ctx.params.erMin} | flow ${f.toFixed(3)} > 0.5 | prix > EMA${ctx.params.emaLen}`,
        tag: 'entry',
      })
    } else if (ctx.params.allowShort && ctx.market === 'futures' && trendDown && candle.close < e && (!ctx.params.useFlowFilter || f < 0.5)) {
      const stop = ctx.roundPrice(candle.close + ctx.params.atrMult * a)
      const qty = ctx.risk.sizeByRisk({ entry: candle.close, stop, riskPct: ctx.params.riskPct })
      if (qty <= 0) return
      ctx.state['stop'] = stop
      ctx.state['bracket'] = false
      await ctx.order.market({
        side: 'SELL',
        qty,
        reason: `Régime 1d baissier | ER ${erV.toFixed(2)} ≥ ${ctx.params.erMin} | flow ${f.toFixed(3)} < 0.5 | prix < EMA${ctx.params.emaLen}`,
        tag: 'entry',
      })
    }
  },

  async onFill(ctx, _fill, order) {
    if (order.tag === 'entry' && ctx.position.qty !== 0 && ctx.state['bracket'] !== true) {
      ctx.state['bracket'] = true
      const long = ctx.position.qty > 0
      const stop = ctx.state['stop'] as number
      ctx.annotate({ type: 'label', time: ctx.time, price: stop, text: 'SL', color: '#f23645' })
      await ctx.order.stopMarket({
        side: long ? 'SELL' : 'BUY',
        qty: Math.abs(ctx.position.qty),
        stopPrice: stop,
        reduceOnly: true,
        reason: `Stop ATR ×${ctx.params.atrMult}`,
        tag: 'sl',
      })
    }
    if ((order.tag === 'sl' || order.tag === 'exit') && ctx.position.qty === 0) {
      ctx.state['bracket'] = false
    }
  },

  async onStop(ctx) {
    await ctx.order.cancelAll()
  },
})
