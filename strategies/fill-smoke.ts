import { defineStrategy, p } from '@tpx/core'

/**
 * FILL SMOKE — validation DÉMO du correctif de l'incident 2026-07-14 (fill
 * d'un algo déclenché perdu → livre désynchronisé → rachat en double 51008).
 *
 * ⚠ DÉMO UNIQUEMENT. Cette stratégie trade en boucle EXPRÈS, à cadence 1m,
 * pour reproduire le chemin exact du bug en quelques minutes au lieu d'attendre
 * un vrai cycle de l'accumulateur.
 *
 * Machine à états (ctx.state.phase) :
 *   buy    → BUY market (budget quote) ; le fill arme un trigger SELL
 *            offsetPct sous le prix → déclenchement attendu en minutes.
 *   wait   → LE test : quand le trigger part, OKX engendre un ordre au clOrdId
 *            « O… » ; son fill DOIT être ingéré (position → ~0, quote crédité).
 *            Avant le fix, la position restait fantôme et le bot rachetait en
 *            double. Ré-armement plus près du prix si le marché est trop calme.
 *   cancel → re-BUY, trigger armé LOIN (−2 %), puis cancelAll au candle
 *            suivant : l'annulation d'un algo non déclenché reste propre, et
 *            un déclenchement de course serait backfillé (fix cancel).
 *   flatten/done → SELL market du solde, fin du cycle.
 *
 * Chaque transaction doit produire un message Telegram (exigence produit) —
 * le smoke valide donc aussi la notification par transaction. Vérifications
 * finales côté DB : l'ordre trig1 est FILLED (pas CANCELED), ses fills sont
 * présents, et le livre du bot colle aux soldes démo réels (garde pré-trade).
 */
export default defineStrategy({
  name: 'Fill Smoke (démo)',
  description:
    "Smoke-test du chemin « trigger déclenché → fill ingéré » (incident 2026-07-14). Cadence 1m, cycle complet en quelques minutes. DÉMO UNIQUEMENT — trade en boucle exprès.",
  markets: ['spot'],
  symbol: 'BTCUSDT',
  backtest: { market: 'spot', denomination: 'quote', initialBalance: 1_000 },

  params: {
    interval: p.interval({ default: '1m', label: 'Unité de temps', group: 'Général' }),
    quoteBudget: p.number({ default: 150, min: 10, max: 10_000, step: 10, label: 'Budget par achat (quote)', group: 'Général' }),
    offsetPct: p.number({
      default: 0.05,
      min: 0.01,
      max: 1,
      step: 0.01,
      label: 'Trigger sous le prix (%)',
      description: 'Assez près pour se déclencher sur le bruit du 1m, assez loin pour ne pas partir au même tick.',
      group: 'Général',
    }),
    rearmBars: p.int({ default: 4, min: 2, max: 120, label: 'Ré-armement si pas déclenché (barres)', group: 'Général' }),
  },

  data: (params) => ({ main: { interval: params.interval } }),

  init() {
    return {}
  },

  async onCandle(ctx, feedId, candle) {
    if (feedId !== 'main') return
    const dust = ctx.symbolInfo?.minQty ?? 1e-8
    const phase = (ctx.state['phase'] as string | undefined) ?? 'buy'
    const holding = ctx.position.qty > dust

    if (phase === 'done') return

    if (phase === 'buy') {
      if (holding) return
      ctx.state['phase'] = 'wait'
      ctx.state['armed'] = false
      await ctx.order.market({
        side: 'BUY',
        quoteQty: ctx.params.quoteBudget,
        reason: 'SMOKE 1/4 : achat initial (le fill armera le trigger)',
        tag: 'entry',
      })
      return
    }

    if (phase === 'wait') {
      if (ctx.state['armed'] !== true) return // fill/armement encore en cours
      if (!holding) {
        // ✅ LE test central : le trigger s'est déclenché et le fill de l'ordre
        // engendré (clOrdId OKX « O… ») a été ingéré en temps réel — la
        // position est revenue à ~0 sans intervention. Avant le fix : fantôme.
        ctx.state['phase'] = 'cancel'
        ctx.state['armed2'] = false
        await ctx.order.market({
          side: 'BUY',
          quoteQty: ctx.params.quoteBudget,
          reason: 'SMOKE 3/4 : ✅ fill du trigger ingéré — achat pour le test d’annulation',
          tag: 'entry2',
        })
        return
      }
      // marché trop calme/monotone : ré-armer en ALTERNANT le côté du trigger
      // (OKX déclenche au TOUCHER du triggerPx, par le haut comme par le bas —
      // vérifié en réel) → déclenchement quasi certain dans la fenêtre suivante.
      // Le cancel exerce backfillIfTriggered à chaque cycle (fix incident).
      const armedAtMs = ctx.state['armedAtMs'] as number | undefined
      if (armedAtMs !== undefined && candle.openTime - armedAtMs >= ctx.params.rearmBars * 60_000) {
        await ctx.order.cancelAll()
        if (ctx.position.qty <= dust) return // déclenché pendant l'annulation → backfillé
        const n = (((ctx.state['rearmN'] as number | undefined) ?? 0) + 1)
        ctx.state['rearmN'] = n
        const above = n % 2 === 1
        const trigger = ctx.roundPrice(candle.close * (above ? 1 + ctx.params.offsetPct / 250 : 1 - ctx.params.offsetPct / 250))
        ctx.state['armedAtMs'] = candle.openTime
        await ctx.order.stopMarket({
          side: 'SELL',
          qty: ctx.roundQty(ctx.position.qty),
          stopPrice: trigger,
          reason: `SMOKE 2/4 : ré-armement ${above ? 'AU-DESSUS' : 'en dessous'} du prix (${trigger})`,
          tag: 'trig1',
        })
      }
      return
    }

    if (phase === 'cancel') {
      if (ctx.state['armed2'] !== true) return
      await ctx.order.cancelAll()
      const qty = ctx.roundQty(ctx.position.qty)
      if (qty > 0) {
        await ctx.order.market({
          side: 'SELL',
          qty,
          reason: 'SMOKE 4/4 : annulation propre vérifiée — nettoyage, fin du cycle',
          tag: 'exit',
        })
      }
      ctx.state['phase'] = 'done'
    }
  },

  async onFill(ctx, fill, order) {
    const dust = ctx.symbolInfo?.minQty ?? 1e-8
    if (order.tag === 'entry' && ctx.position.qty > dust && ctx.state['armed'] !== true) {
      ctx.state['armed'] = true
      ctx.state['armedAtMs'] = ctx.time
      const trigger = ctx.roundPrice(fill.price * (1 - ctx.params.offsetPct / 100))
      await ctx.order.stopMarket({
        side: 'SELL',
        qty: ctx.roundQty(ctx.position.qty),
        stopPrice: trigger,
        reason: `SMOKE 2/4 : trigger SELL armé à ${trigger} — déclenchement attendu en quelques minutes`,
        tag: 'trig1',
      })
    }
    if (order.tag === 'entry2' && ctx.position.qty > dust && ctx.state['armed2'] !== true) {
      ctx.state['armed2'] = true
      const trigger = ctx.roundPrice(fill.price * 0.98)
      await ctx.order.stopMarket({
        side: 'SELL',
        qty: ctx.roundQty(ctx.position.qty),
        stopPrice: trigger,
        reason: 'SMOKE 3/4 : trigger lointain (−2 %) pour le test d’annulation propre',
        tag: 'trig2',
      })
    }
  },

  async onStop(ctx) {
    await ctx.order.cancelAll()
  },
})
