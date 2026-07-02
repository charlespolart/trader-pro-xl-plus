/**
 * Banc d'essai EXITS pour l'accumulateur (la validation a montré que l'edge
 * vit dans la mécanique d'excursion, pas le régime). ENTRÉE = v2 défauts,
 * FIGÉE. EXIT commutable :
 *   - recross      : rachat au recroisement EMA50 (= v2, contrôle de parité)
 *   - trail        : stop de rachat TRAILÉ = plusBasClose + k×ATR (ratchet vers
 *                    le bas, re-posté quand il baisse) — sort mécaniquement sur
 *                    tout rebond > k×ATR, chevauche la jambe de baisse sinon
 *   - ladder       : rachats LIMIT échelonnés sous le prix de vente (achat de
 *                    capitulation, frais maker) + recross pour le reliquat.
 *                    ⚠ les limites verrouillent l'USDT → le plafond de perte est
 *                    émulé à la CLÔTURE de barre (pas intrabar) dans ce mode.
 *   - trailrecross : sort au PREMIER de trail / recross
 * minHoldBars : le recross ne peut sortir qu'après M barres (stop toujours actif).
 * Stop initial v2 (min(entrée+2,5×ATR, entrée×1,05)) = plafond de perte partout.
 */
import { defineStrategy, ind, p } from '@tpx/core'

export const v4exits = defineStrategy({
  name: 'v4 exits (recherche)',
  description: 'Entrée v2 figée, mécanique de sortie commutable (recross/trail/ladder).',
  markets: ['spot'],
  backtest: { denomination: 'base', initialBalance: 1, market: 'spot' },
  params: {
    interval: p.interval({ default: '4h', label: 'TF timing' }),
    exitMode: p.select({
      default: 'recross',
      options: ['recross', 'trail', 'ladder', 'trailrecross'] as const,
      label: 'Mode de sortie',
    }),
    trailAtrMult: p.number({ default: 2.5, min: 0.5, max: 8, step: 0.1, label: 'Trail = plus bas close + k×ATR' }),
    ladderSteps: p.int({ default: 3, min: 1, max: 6, label: 'Tranches du ladder' }),
    ladderStepPct: p.number({ default: 5, min: 1, max: 15, step: 0.5, label: 'Espacement du ladder (%)' }),
    minHoldBars: p.int({ default: 0, min: 0, max: 60, label: 'Barres avant que le recross puisse sortir' }),
    // ---- entrée v2 (défauts figés)
    erLen: p.int({ default: 20, min: 5, max: 60, label: 'ER' }),
    erMin: p.number({ default: 0.35, min: 0.1, max: 0.8, step: 0.05, label: 'ER min' }),
    emaLen: p.int({ default: 50, min: 10, max: 200, label: 'EMA vente' }),
    rebuyEmaLen: p.int({ default: 50, min: 10, max: 400, label: 'EMA rachat' }),
    useFlowFilter: p.bool({ default: true, label: 'Flow' }),
    flowLen: p.int({ default: 10, min: 2, max: 50, label: 'Flow len' }),
    trendMaLen: p.int({ default: 60, min: 10, max: 400, label: 'EMA tendance 3d' }),
    trendSlopeBars: p.int({ default: 8, min: 0, max: 90, label: 'Déclin 3d' }),
    useConfirm: p.bool({ default: true, label: 'Double confirmation' }),
    confirmMaLen: p.int({ default: 200, min: 10, max: 400, label: 'EMA confirm 1d' }),
    confirmSlopeBars: p.int({ default: 30, min: 0, max: 90, label: 'Déclin confirm' }),
    atrPeriod: p.int({ default: 14, min: 2, max: 100, label: 'ATR' }),
    stopAtrMult: p.number({ default: 2.5, min: 0.5, max: 8, step: 0.1, label: 'Stop initial ATR×' }),
    maxLossPct: p.number({ default: 5, min: 0, max: 20, step: 0.5, label: 'Perte max %' }),
  },
  data: (params) => ({
    main: { interval: params.interval },
    trend: { interval: '3d' },
    confirm: { interval: '1d' },
  }),
  init(ctx) {
    return {
      er: ctx.indicator('main', ind.efficiencyRatio(ctx.params.erLen), { plot: 'none' }),
      ema: ctx.indicator('main', ind.ema(ctx.params.emaLen), { plot: 'none' }),
      rebuyEma: ctx.indicator('main', ind.ema(ctx.params.rebuyEmaLen), { plot: 'none' }),
      flow: ctx.indicator('main', ind.takerFlow(ctx.params.flowLen), { plot: 'none' }),
      atr: ctx.indicator('main', ind.atr(ctx.params.atrPeriod), { plot: 'none' }),
      trendMa: ctx.indicator('trend', ind.ema(ctx.params.trendMaLen), { plot: 'none' }),
      confirmMa: ctx.indicator('confirm', ind.ema(ctx.params.confirmMaLen), { plot: 'none' }),
    }
  },
  async onCandle(ctx, feedId, candle) {
    if (feedId !== 'main') return
    const { er, ema, rebuyEma, flow, atr, trendMa, confirmMa } = ctx.locals
    if (!er.ready || !ema.ready || !rebuyEma.ready || !atr.ready || (ctx.params.useFlowFilter && !flow.ready)) return
    if (!trendMa.ready || (ctx.params.useConfirm && !confirmMa.ready)) return

    const a = atr.value ?? 0
    const sold = ctx.state['sold'] === true
    const quoteAsset = ctx.symbolInfo?.baseAsset ?? '___'
    const quote = ctx.balances.find((b) => b.asset !== quoteAsset)
    const freeUsdt = quote ? quote.free : 0

    if (!sold) {
      // ---- ENTRÉE (v2, figée)
      const trendClose = ctx.feed('trend').candles.close(0)
      const belowTrendMa = trendClose !== null && trendClose < (trendMa.value ?? 0)
      const slopeOk =
        ctx.params.trendSlopeBars === 0 ||
        (trendMa.value !== null && (trendMa.at(ctx.params.trendSlopeBars) ?? Infinity) > trendMa.value)
      const trendBear = belowTrendMa && slopeOk
      const confirmClose = ctx.feed('confirm').candles.close(0)
      const belowConfirmMa = confirmClose !== null && confirmClose < (confirmMa.value ?? 0)
      const confirmSlopeOk =
        ctx.params.confirmSlopeBars === 0 ||
        (confirmMa.value !== null && (confirmMa.at(ctx.params.confirmSlopeBars) ?? Infinity) > confirmMa.value)
      const confirmBear = !ctx.params.useConfirm || (belowConfirmMa && confirmSlopeOk)
      const cleanTrend = er.value! >= ctx.params.erMin
      const f = flow.value ?? 0.5
      const sellingFlow = !ctx.params.useFlowFilter || f < 0.5
      const belowEma = candle.close < ema.value!

      if (trendBear && confirmBear && cleanTrend && sellingFlow && belowEma && a > 0) {
        const qty = ctx.roundQty(ctx.position.qty)
        if (qty <= 0) return
        const atrStop = candle.close + ctx.params.stopAtrMult * a
        const maxLossStop =
          ctx.params.maxLossPct > 0 ? candle.close * (1 + ctx.params.maxLossPct / 100) : Number.POSITIVE_INFINITY
        ctx.state['stop'] = ctx.roundPrice(Math.min(atrStop, maxLossStop))
        ctx.state['soldPrice'] = candle.close
        ctx.state['lowest'] = candle.close
        ctx.state['holdBars'] = 0
        ctx.state['sold'] = true
        ctx.state['bracket'] = false
        await ctx.order.market({ side: 'SELL', qty, reason: 'régime baissier → vente', tag: 'entry' })
      }
      return
    }

    // ---- EXCURSION EN COURS
    ctx.state['holdBars'] = ((ctx.state['holdBars'] as number) ?? 0) + 1
    const holdBars = ctx.state['holdBars'] as number
    const mode = ctx.params.exitMode
    ctx.state['lowest'] = Math.min((ctx.state['lowest'] as number) ?? candle.close, candle.close)
    const lowest = ctx.state['lowest'] as number

    // ladder : plafond de perte émulé à la clôture (les limites verrouillent l'USDT)
    if (mode === 'ladder' && candle.close >= (ctx.state['stop'] as number)) {
      await ctx.order.cancelAll()
      const q2 = ctx.balances.find((b) => b.asset !== quoteAsset)
      const rest = q2 ? q2.free : 0
      if (rest > 0) {
        await ctx.order.market({ side: 'BUY', quoteQty: rest, reason: 'plafond de perte (clôture)', tag: 'sl' })
      }
      return
    }

    // trailing : abaisse le stop vers plusBasClose + k×ATR (jamais remonté)
    if ((mode === 'trail' || mode === 'trailrecross') && freeUsdt > 0 && a > 0) {
      const cur = ctx.state['stop'] as number
      const cand = ctx.roundPrice(lowest + ctx.params.trailAtrMult * a)
      if (cand < cur) {
        ctx.state['stop'] = cand
        await ctx.order.cancelAll('sl')
        const qty = ctx.roundQty((freeUsdt / cand) * 0.995)
        if (qty > 0) {
          await ctx.order.stopMarket({ side: 'BUY', qty, stopPrice: cand, reason: 'trail', tag: 'sl' })
        }
      }
    }

    // recross : rachat du reliquat au recroisement EMA (sauf trail pur / min-hold)
    const recrossAllowed = mode !== 'trail' && holdBars > ctx.params.minHoldBars
    if (recrossAllowed && candle.close > rebuyEma.value!) {
      await ctx.order.cancelAll()
      const q2 = ctx.balances.find((b) => b.asset !== quoteAsset)
      const rest = q2 ? q2.free : 0
      if (rest > 0) {
        await ctx.order.market({ side: 'BUY', quoteQty: rest, reason: 'rachat recross', tag: 'exit' })
      }
    }
  },
  async onFill(ctx, _fill, order) {
    const quoteAsset = ctx.symbolInfo?.baseAsset ?? '___'
    const read = () => {
      const q = ctx.balances.find((b) => b.asset !== quoteAsset)
      return { free: q ? q.free : 0, total: q ? q.free + q.locked : 0 }
    }

    if (order.tag === 'entry' && ctx.state['bracket'] !== true) {
      ctx.state['bracket'] = true
      const stop = ctx.state['stop'] as number
      const { free } = read()
      if (ctx.params.exitMode === 'ladder') {
        // tranches LIMIT sous le prix de vente (le stop est émulé à la clôture)
        const soldPx = ctx.state['soldPrice'] as number
        const L = ctx.params.ladderSteps
        const per = free / L
        for (let i = 1; i <= L; i++) {
          const px = ctx.roundPrice(soldPx * (1 - (i * ctx.params.ladderStepPct) / 100))
          const qty = ctx.roundQty((per / px) * 0.995)
          if (qty > 0) {
            await ctx.order.limit({ side: 'BUY', qty, price: px, reason: `ladder ${i}/${L}`, tag: 'ladder' })
          }
        }
      } else if (stop > 0 && free > 0) {
        const qty = ctx.roundQty((free / stop) * 0.995)
        if (qty > 0) {
          await ctx.order.stopMarket({ side: 'BUY', qty, stopPrice: stop, reason: 'stop', tag: 'sl' })
        }
      }
      return
    }

    // un rachat (partiel ou total) vient d'exécuter → l'excursion est-elle finie ?
    if (order.side === 'BUY') {
      const { total } = read()
      const minLeft = Math.max(5, (ctx.symbolInfo?.minNotional ?? 5) * 1.2)
      if (total <= minLeft) {
        ctx.state['sold'] = false
        ctx.state['bracket'] = false
        await ctx.order.cancelAll()
      }
    }
  },
  async onStop(ctx) {
    await ctx.order.cancelAll()
    if (ctx.state['sold'] === true) {
      const quote = ctx.balances.find((b) => b.asset !== (ctx.symbolInfo?.baseAsset ?? '___'))
      const usdt = quote ? quote.free : 0
      if (usdt > 0) await ctx.order.market({ side: 'BUY', quoteQty: usdt, reason: 'fin : retour en BTC', tag: 'exit' })
      ctx.state['sold'] = false
    }
  },
})
