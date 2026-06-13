import { defineStrategy, ind, p } from '@tpx/core'

/**
 * BTC Accumulator — accumuler du BTC, pas de l'USDT.
 *
 * Philosophie : on DÉTIENT du BTC par défaut. Le seul but est d'en avoir le
 * plus possible. On ne dépense jamais de BTC pour spéculer — on ne fait RIEN
 * en régime haussier (on garde son BTC, on capte la hausse). Uniquement quand
 * le marché est clairement baissier, on VEND tout le BTC contre USDT, puis on
 * le RACHÈTE plus bas → on termine avec plus de BTC.
 *
 * À lancer en backtest avec denomination='base' (capital de départ en BTC,
 * performance mesurée en BTC). Spot uniquement. Le benchmark à battre est
 * « garder son BTC » = 0 % — chaque % au-dessus, c'est du BTC gagné.
 *
 * Détection du régime baissier :
 *   - VRAI bear soutenu : EMA200 1d en déclin depuis N jours (htfSlopeDays=30)
 *     — c'est le filtre déterminant : ne vend QUE dans un vrai marché baissier,
 *     pas sur un simple repli sous l'EMA200 (qui saignait en bull/chop)
 *   - prix sous l'EMA200 journalière
 *   - tendance propre : Efficiency Ratio ≥ seuil (vraie baisse, pas du bruit)
 *   - flux vendeur : takerFlow < 0.5 (les agressifs vendent)
 *   - prix sous l'EMA locale
 * Sortie (rachat) : le prix recroise l'EMA locale par le haut (la baisse
 * s'essouffle) OU stop ATR si le prix repart à la hausse (on s'est trompé →
 * on rachète vite pour limiter la perte de BTC).
 *
 * Recherche 2026-06 (BTCUSDT spot, dénomination base, 2020-2026) :
 *   - sans filtre de pente : full -10% BTC (saigne en bull/chop) ;
 *   - avec pente 30j : full +88% BTC, OOS +8%, bear 2022 +107%, DD -28%.
 *   - plateau monotone (7j→+12%, 14j→+50%, 30j→+88%) — robuste, pas un pic.
 * C'est un accumulateur de BEAR : l'essentiel du gain vient des marchés
 * franchement baissiers ; en bull/chop il fait ~0. Drawdown en BTC réel
 * (être en USDT pendant un pump). Re-fit périodique recommandé.
 */
export default defineStrategy({
  name: 'BTC Accumulator',
  description:
    "Accumulation de BTC : détient du BTC, vend tout uniquement en régime franchement baissier (ER + flow) pour racheter plus bas. Spot, à lancer en dénomination BASE.",
  markets: ['spot'],
  // pré-remplit le formulaire de backtest : on raisonne en BTC, capital = 1 BTC
  backtest: { denomination: 'base', initialBalance: 1, market: 'spot' },

  params: {
    interval: p.interval({ default: '4h', label: 'Unité de temps', group: 'Général' }),

    erLen: p.int({ default: 20, min: 5, max: 60, label: 'Période Efficiency Ratio', group: 'Régime baissier' }),
    erMin: p.number({ default: 0.35, min: 0.1, max: 0.8, step: 0.05, label: 'ER minimum', group: 'Régime baissier' }),
    emaLen: p.int({ default: 50, min: 10, max: 200, label: 'EMA locale (vente)', group: 'Régime baissier' }),
    rebuyEmaLen: p.int({
      default: 75,
      min: 10,
      max: 400,
      label: 'EMA de rachat',
      description:
        "EMA dont le recroisement par le haut déclenche le rachat. Plus LENTE que l'EMA de vente = on tient le short plus longtemps au lieu de racheter au premier sursaut (cause n°1 des trades perdants). 75 = validé (+30 pts de BTC vs 50), mais à re-fitter (valeur sensible).",
      group: 'Régime baissier',
    }),
    useHtf: p.bool({ default: true, label: 'Filtre EMA200 1d', group: 'Régime baissier' }),
    htfSlopeDays: p.int({
      default: 30,
      min: 0,
      max: 90,
      label: 'EMA200 1d en déclin depuis N jours',
      description:
        "0 = off. Sinon ne vend que si l'EMA200 journalière baisse depuis N jours (vrai bear soutenu). 30 = validé (full +88% BTC vs -10% sans).",
      group: 'Régime baissier',
    }),
    useFlowFilter: p.bool({ default: true, label: 'Confirmation taker-flow', group: 'Régime baissier' }),
    flowLen: p.int({ default: 10, min: 2, max: 50, label: 'Lissage du flux', group: 'Régime baissier' }),

    atrPeriod: p.int({ default: 14, min: 2, max: 100, label: 'Période ATR', group: 'Risque' }),
    stopAtrMult: p.number({
      default: 2.5,
      min: 0.5,
      max: 8,
      step: 0.1,
      label: 'Stop = ATR ×',
      description: 'Rachat forcé si le prix remonte de N×ATR (on s’est trompé) — limite la perte de BTC',
      group: 'Risque',
    }),
    maxLossPct: p.number({
      default: 5,
      min: 0,
      max: 20,
      step: 0.5,
      label: 'Perte max par trade (%)',
      description:
        "Plafond DUR de perte de BTC : rachat forcé si le prix remonte de N % au-dessus de la vente, peu importe la volatilité. 0 = off (le stop ATR seul, qui en forte vol laissait filer la perte jusqu'à 10 %). 5 % = validé (plafonne les pertes ET améliore le rendement).",
      group: 'Risque',
    }),
  },

  data: (params) => ({
    main: { interval: params.interval },
    htf: { interval: '1d' },
  }),

  init(ctx) {
    return {
      er: ctx.indicator('main', ind.efficiencyRatio(ctx.params.erLen), { plot: 'pane' }),
      ema: ctx.indicator('main', ind.ema(ctx.params.emaLen), { color: '#ff9800' }),
      rebuyEma: ctx.indicator('main', ind.ema(ctx.params.rebuyEmaLen), {
        plot: ctx.params.rebuyEmaLen === ctx.params.emaLen ? 'none' : 'overlay',
        color: '#26a69a',
      }),
      flow: ctx.indicator('main', ind.takerFlow(ctx.params.flowLen), { plot: 'pane' }),
      atr: ctx.indicator('main', ind.atr(ctx.params.atrPeriod), { plot: 'none' }),
      htfEma: ctx.indicator('htf', ind.ema(200), { plot: 'none' }),
    }
  },

  async onCandle(ctx, feedId, candle) {
    if (feedId !== 'main') return
    const { er, ema, rebuyEma, flow, atr, htfEma } = ctx.locals
    if (!er.ready || !ema.ready || !rebuyEma.ready || !atr.ready || (ctx.params.useFlowFilter && !flow.ready)) return
    if (ctx.params.useHtf && !htfEma.ready) return

    const e = ema.value!
    const a = atr.value ?? 0
    // les frais (hors BNB) laissent un solde BTC non aligné sur le stepSize :
    // on ignore les miettes sous minQty pour décider de l'état
    const dust = ctx.symbolInfo?.minQty ?? 1e-8
    // position.qty > dust  ⇒ on détient du BTC (état par défaut)
    // sinon                ⇒ on a vendu, on est en USDT (trade baissier en cours)
    const holdingBtc = ctx.position.qty > dust

    if (holdingBtc) {
      // ---- on détient du BTC : vendre UNIQUEMENT si le régime est franchement baissier
      const htfClose = ctx.feed('htf').candles.close(0)
      const belowHtfEma = htfClose !== null && htfClose < (htfEma.value ?? 0)
      // EMA200 1d en déclin = vrai bear soutenu (pas un simple repli)
      const slopeOk =
        ctx.params.htfSlopeDays === 0 ||
        (htfEma.value !== null && (htfEma.at(ctx.params.htfSlopeDays) ?? Infinity) > htfEma.value)
      const bearRegime = !ctx.params.useHtf || (belowHtfEma && slopeOk)
      const cleanTrend = er.value! >= ctx.params.erMin
      const f = flow.value ?? 0.5
      const sellingFlow = !ctx.params.useFlowFilter || f < 0.5
      const belowEma = candle.close < e

      if (bearRegime && cleanTrend && sellingFlow && belowEma && a > 0) {
        const qty = ctx.roundQty(ctx.position.qty)
        if (qty <= 0) return
        // stop = le PLUS SERRÉ entre le stop ATR et le plafond de perte en %.
        // Le plafond garantit qu'on ne perd jamais plus de maxLossPct de BTC,
        // même quand l'ATR est énorme (forte vol) où le stop ATR seul laissait
        // filer la perte jusqu'à ~10 %.
        const atrStop = candle.close + ctx.params.stopAtrMult * a
        const maxLossStop =
          ctx.params.maxLossPct > 0 ? candle.close * (1 + ctx.params.maxLossPct / 100) : Number.POSITIVE_INFINITY
        ctx.state['stop'] = ctx.roundPrice(Math.min(atrStop, maxLossStop))
        ctx.state['bracket'] = false
        ctx.state['soldPrice'] = candle.close
        await ctx.order.market({
          side: 'SELL',
          qty,
          reason: `Régime baissier (ER ${er.value!.toFixed(2)}, flow ${f.toFixed(2)}, prix < EMA${ctx.params.emaLen}) → vente du BTC pour rachat plus bas`,
          tag: 'entry',
        })
      }
      return
    }

    // ---- on est en USDT (vendu) : racheter quand la baisse s'essouffle, mais
    // sur l'EMA de RACHAT (potentiellement plus lente) pour ne pas racheter au
    // premier sursaut — c'était la cause n°1 des trades perdants (whipsaws).
    if (candle.close > rebuyEma.value!) {
      await ctx.order.cancelAll()
      const quote = ctx.balances.find((b) => b.asset !== (ctx.symbolInfo?.baseAsset ?? '___'))
      const usdt = quote ? quote.free : 0
      if (usdt <= 0) return
      const sold = (ctx.state['soldPrice'] as number | undefined) ?? candle.close
      const gainPct = ((sold - candle.close) / sold) * 100
      await ctx.order.market({
        side: 'BUY',
        quoteQty: usdt,
        reason: `Rachat sur recroisement EMA${ctx.params.rebuyEmaLen} (vendu ${sold.toFixed(0)} → rachat ${candle.close.toFixed(0)}, ${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(1)}% en BTC)`,
        tag: 'exit',
      })
    }
  },

  async onFill(ctx, _fill, order) {
    const dust = ctx.symbolInfo?.minQty ?? 1e-8
    // après la vente : poser le stop de rachat (rachat forcé si le prix remonte)
    if (order.tag === 'entry' && ctx.position.qty <= dust && ctx.state['bracket'] !== true) {
      ctx.state['bracket'] = true
      const stop = ctx.state['stop'] as number
      const quote = ctx.balances.find((b) => b.asset !== (ctx.symbolInfo?.baseAsset ?? '___'))
      const usdt = quote ? quote.free : 0
      if (stop > 0 && usdt > 0) {
        // racheter ~tout l'USDT au prix de déclenchement. Marge de 0,5 % :
        // le fill se fait à stop×(1+slippage) + frais, donc usdt/stop pile
        // serait rejeté pour fonds insuffisants (le stop ne se déclencherait
        // jamais). Le petit reliquat d'USDT est réutilisé au cycle suivant.
        const qty = ctx.roundQty((usdt / stop) * 0.995)
        if (qty > 0) {
          ctx.annotate({ type: 'label', time: ctx.time, price: stop, text: 'rachat stop', color: '#f23645' })
          await ctx.order.stopMarket({
            side: 'BUY',
            qty,
            stopPrice: stop,
            reason: `Stop : le prix est remonté de ${ctx.params.stopAtrMult}×ATR → rachat pour limiter la perte de BTC`,
            tag: 'sl',
          })
        }
      }
    }
    if ((order.tag === 'sl' || order.tag === 'exit') && ctx.position.qty > dust) {
      ctx.state['bracket'] = false
    }
  },

  async onStop(ctx) {
    await ctx.order.cancelAll()
    const dust = ctx.symbolInfo?.minQty ?? 1e-8
    // on veut TOUJOURS finir en détenant du BTC : si on est en USDT à l'arrêt, racheter
    if (ctx.position.qty <= dust) {
      const quote = ctx.balances.find((b) => b.asset !== (ctx.symbolInfo?.baseAsset ?? '___'))
      const usdt = quote ? quote.free : 0
      if (usdt > 0) {
        await ctx.order.market({ side: 'BUY', quoteQty: usdt, reason: 'Arrêt : retour en BTC', tag: 'exit' })
      }
    }
  },
})
