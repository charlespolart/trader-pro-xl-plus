import { defineStrategy, ind, p } from '@tpx/core'

/**
 * BTC Accumulator v2 — tendance générale sur une UNITÉ DE TEMPS DÉDIÉE.
 *
 * Identique à btc-accumulator (même cœur : ER + taker-flow + EMA locale +
 * stop/plafond), à UNE différence near : le filtre de tendance « vrai bear »
 * n'est plus figé sur l'EMA200 journalière. Ici l'unité de temps de la
 * tendance (trendInterval), la longueur de sa moyenne (trendMaLen) et la durée
 * de déclin exigée (trendSlopeBars, en bougies de CETTE unité) sont des
 * paramètres. On peut donc détecter la tendance générale sur du 1d, 3d ou 1w,
 * tandis que les entrées/sorties restent timées sur le feed `main` (4 h).
 *
 * Pourquoi : la « tendance générale » se lit mieux sur une grande unité de
 * temps (moins de bruit), et la confirmation/timing se fait sur le 4 h — mais
 * sans dépendre d'une EMA200 calculée sur le 4 h (trop courte = trop bruitée).
 * La v1 faisait déjà tendance=1d + timing=4h ; la v2 rend ce TF tunable pour
 * tester s'il vaut mieux monter en 3d/1w.
 *
 * IMPORTANT : la v1 (btc-accumulator) reste la stratégie de référence validée.
 * Celle-ci est un banc d'essai — mais le résultat est net (voir ci-dessous).
 *
 * À lancer en backtest avec denomination='base' (capital en BTC). Spot.
 *
 * Recherche 2026-06 (BTCUSDT spot, base, 2020-2026) — comparaison du TF de
 * tendance, le reste du cœur identique à la v1 :
 *   - parité : 3d/.. mis à part, v2 réglée 1d/200/30 == v1 au centième (full
 *     +103%, OOS +10,6%) → la v2 est une vraie généralisation, pas une réécriture.
 *   - la tendance sur 3 JOURS bat le journalier sur TOUT le plateau balayé
 *     (trendMaLen 50-100 × déclin 6-12) : les 20 réglages 3d sont POSITIFS en
 *     OOS (v1 +10,6% → médiane 3d ~+16%, meilleur +29,9%), full +82..+160%.
 *     Crête lisse sur EMA60-70 / déclin 6-8 (pas une aiguille = effet robuste
 *     du timeframe, pas un sur-ajustement). Défaut retenu : 3d / EMA60 / 8.
 *   - le 1w marche aussi (OOS +14..+21%) mais en deçà du 3d en full.
 *   - walk-forward 6 fenêtres (OOS 2021→2026) : 3d FIGÉ compose +122% (4/6
 *     fenêtres+) > v1 figé +89% (3/6) > ré-optim du TF +79% (2/6, NUIT →
 *     verrouiller le TF, ne PAS le mettre en refit).
 *
 * DOUBLE CONFIRMATION (useConfirm, défaut ON) — anti-drawdown : le 3d seul
 * whipsaw dans les corrections de bull (vendre puis V-recovery) → -44% DD /
 * +55% sur 2019→2026. Exiger qu'un 2ᵉ TF plus lent (journalier, EMA200 déclin
 * 30j = le filtre v1) soit AUSSI baissier coupe ces faux signaux : 2019→2026
 * passe à -30% DD / +85% (DD ramené au niveau v1 ET rendement en hausse ; pertes
 * 2019/2020 ~divisées par 2 ; le bear 2022 +88,8% intact). En walk-forward
 * (OOS 2021→2026, sans ces whipsaws) c'est NEUTRE (+117% vs +122%, même DD) →
 * filtre de sécurité non sur-ajusté : protège quand le danger est là, ne dégrade
 * pas sinon. Coût : -17 pts sur la fenêtre douce 2020-08→2026 (+160→+143).
 *
 * Réglages selon l'unité de temps de tendance (l'EMA a besoin de ~trendMaLen
 * bougies pour être prête) :
 *   - 3d : trendMaLen 60-70, trendSlopeBars 6-8  (DÉFAUT, validé sur le plateau)
 *   - 1d : trendMaLen 200, trendSlopeBars 30     (= équivalent v1)
 *   - 1w : trendMaLen 40-50, trendSlopeBars 4-6
 * Une EMA200 sur 1w demanderait ~4 ans de données pour être prête → inadapté.
 */
export default defineStrategy({
  name: 'BTC Accumulator v2',
  description:
    "Accumulation de BTC : tendance générale sur un TF dédié (3d par défaut) avec double confirmation journalière (anti-drawdown). Spot, dénomination BASE.",
  markets: ['spot'],
  backtest: { denomination: 'base', initialBalance: 1, market: 'spot' },

  params: {
    interval: p.interval({ default: '4h', label: 'Unité de temps (timing)', group: 'Général' }),

    erLen: p.int({ default: 20, min: 5, max: 60, label: 'Période Efficiency Ratio', group: 'Régime baissier' }),
    erMin: p.number({ default: 0.35, min: 0.1, max: 0.8, step: 0.05, label: 'ER minimum', group: 'Régime baissier' }),
    emaLen: p.int({ default: 50, min: 10, max: 200, label: 'EMA locale (vente)', group: 'Régime baissier' }),
    rebuyEmaLen: p.int({
      default: 50,
      min: 10,
      max: 400,
      label: 'EMA de rachat',
      description:
        "EMA dont le recroisement par le haut déclenche le rachat. Défaut 50 (= EMA de vente, neutre/conservateur). Plus lente (75-100) = tient le short plus longtemps.",
      group: 'Régime baissier',
    }),
    useFlowFilter: p.bool({ default: true, label: 'Confirmation taker-flow', group: 'Régime baissier' }),
    flowLen: p.int({ default: 10, min: 2, max: 50, label: 'Lissage du flux', group: 'Régime baissier' }),

    // ---- TENDANCE GÉNÉRALE (la nouveauté v2) : sur son propre TF
    useTrend: p.bool({ default: true, label: 'Filtre de tendance générale', group: 'Tendance générale' }),
    trendInterval: p.interval({
      default: '3d',
      label: 'Unité de temps de la tendance',
      description:
        "L'unité de temps sur laquelle on lit la tendance générale (la macro). 3d = défaut validé (bat le 1d sur tout le plateau, OOS et full). 1d = comme la v1. 1w = plus lisse encore mais en deçà du 3d.",
      group: 'Tendance générale',
    }),
    trendMaLen: p.int({
      default: 60,
      min: 10,
      max: 400,
      label: 'Longueur de la MA de tendance',
      description:
        "Période de l'EMA de tendance, en bougies de trendInterval. 60 sur 3d = défaut validé (crête du plateau EMA60-70). 200 sur 1d = l'EMA200 journalière de la v1. Adapter à l'unité de temps (1w → 40-50, sinon jamais prête).",
      group: 'Tendance générale',
    }),
    trendSlopeBars: p.int({
      default: 8,
      min: 0,
      max: 90,
      label: 'MA de tendance en déclin depuis N bougies',
      description:
        "0 = off. Sinon ne vend que si la MA de tendance baisse depuis N bougies de trendInterval (vrai bear soutenu). 8 sur 3d = défaut validé (24 jours). 30 sur 1d = les 30 jours de la v1 ; sur 1w viser 4-6.",
      group: 'Tendance générale',
    }),

    // ---- DOUBLE CONFIRMATION : exiger un 2ᵉ TF (plus lent) baissier en même
    // temps. Le 3d seul whipsaw dans les corrections de bull (2019-2020) →
    // demander que le journalier soit AUSSI en bear filtre ces faux signaux.
    useConfirm: p.bool({
      default: true,
      label: 'Double confirmation (2ᵉ TF)',
      description:
        "Ne vendre que si la tendance est baissière sur le TF de tendance ET sur un 2ᵉ TF plus lent (journalier). Coupe les whipsaws des corrections de bull (réduit le drawdown).",
      group: 'Confirmation 2ᵉ TF',
    }),
    confirmInterval: p.interval({
      default: '1d',
      label: 'Unité de temps de confirmation',
      description: 'Le 2ᵉ TF, plus lent, qui doit AUSSI être baissier. Journalier par défaut (le filtre de la v1).',
      group: 'Confirmation 2ᵉ TF',
    }),
    confirmMaLen: p.int({
      default: 200,
      min: 10,
      max: 400,
      label: 'Longueur MA de confirmation',
      description: 'EMA du 2ᵉ TF. 200 sur 1d = EMA200 journalière (la macro de référence).',
      group: 'Confirmation 2ᵉ TF',
    }),
    confirmSlopeBars: p.int({
      default: 30,
      min: 0,
      max: 90,
      label: 'MA de confirmation en déclin depuis N bougies',
      description: '0 = exiger seulement le prix sous la MA. 30 sur 1d = EMA200 en déclin depuis 30 jours (v1).',
      group: 'Confirmation 2ᵉ TF',
    }),

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
        "Plafond DUR de perte de BTC : rachat forcé si le prix remonte de N % au-dessus de la vente, peu importe la volatilité. 0 = off.",
      group: 'Risque',
    }),
  },

  data: (params) => ({
    main: { interval: params.interval },
    trend: { interval: params.trendInterval },
    confirm: { interval: params.confirmInterval },
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
      // EMA de tendance sur son unité de temps dédiée (1d/3d/1w)
      trendMa: ctx.indicator('trend', ind.ema(ctx.params.trendMaLen), { plot: 'none' }),
      // EMA de confirmation sur le 2ᵉ TF (journalier) — double confirmation
      confirmMa: ctx.indicator('confirm', ind.ema(ctx.params.confirmMaLen), { plot: 'none' }),
    }
  },

  async onCandle(ctx, feedId, candle) {
    if (feedId !== 'main') return
    const { er, ema, rebuyEma, flow, atr, trendMa, confirmMa } = ctx.locals
    if (!er.ready || !ema.ready || !rebuyEma.ready || !atr.ready || (ctx.params.useFlowFilter && !flow.ready)) return
    if (ctx.params.useTrend && !trendMa.ready) return
    if (ctx.params.useConfirm && !confirmMa.ready) return

    const e = ema.value!
    const a = atr.value ?? 0
    const dust = ctx.symbolInfo?.minQty ?? 1e-8
    const holdingBtc = ctx.position.qty > dust

    if (holdingBtc) {
      // ---- on détient du BTC : vendre UNIQUEMENT si le régime est franchement baissier
      const trendClose = ctx.feed('trend').candles.close(0)
      const belowTrendMa = trendClose !== null && trendClose < (trendMa.value ?? 0)
      // MA de tendance en déclin = vrai bear soutenu (pas un simple repli)
      const slopeOk =
        ctx.params.trendSlopeBars === 0 ||
        (trendMa.value !== null && (trendMa.at(ctx.params.trendSlopeBars) ?? Infinity) > trendMa.value)
      const trendBear = !ctx.params.useTrend || (belowTrendMa && slopeOk)
      // double confirmation : le 2ᵉ TF (journalier) doit AUSSI être baissier
      const confirmClose = ctx.feed('confirm').candles.close(0)
      const belowConfirmMa = confirmClose !== null && confirmClose < (confirmMa.value ?? 0)
      const confirmSlopeOk =
        ctx.params.confirmSlopeBars === 0 ||
        (confirmMa.value !== null && (confirmMa.at(ctx.params.confirmSlopeBars) ?? Infinity) > confirmMa.value)
      const confirmBear = !ctx.params.useConfirm || (belowConfirmMa && confirmSlopeOk)
      const bearRegime = trendBear && confirmBear
      const cleanTrend = er.value! >= ctx.params.erMin
      const f = flow.value ?? 0.5
      const sellingFlow = !ctx.params.useFlowFilter || f < 0.5
      const belowEma = candle.close < e

      if (bearRegime && cleanTrend && sellingFlow && belowEma && a > 0) {
        const qty = ctx.roundQty(ctx.position.qty)
        if (qty <= 0) return
        const atrStop = candle.close + ctx.params.stopAtrMult * a
        const maxLossStop =
          ctx.params.maxLossPct > 0 ? candle.close * (1 + ctx.params.maxLossPct / 100) : Number.POSITIVE_INFINITY
        ctx.state['stop'] = ctx.roundPrice(Math.min(atrStop, maxLossStop))
        ctx.state['bracket'] = false
        ctx.state['soldPrice'] = candle.close
        await ctx.order.market({
          side: 'SELL',
          qty,
          reason: `Régime baissier (tendance ${ctx.params.trendInterval}${ctx.params.useConfirm ? `+${ctx.params.confirmInterval}` : ''} en déclin, ER ${er.value!.toFixed(2)}, flow ${f.toFixed(2)}, prix < EMA${ctx.params.emaLen}) → vente du BTC pour rachat plus bas`,
          tag: 'entry',
        })
      }
      return
    }

    // ---- on est en USDT (vendu) : racheter quand la baisse s'essouffle
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
    if (order.tag === 'entry' && ctx.position.qty <= dust && ctx.state['bracket'] !== true) {
      ctx.state['bracket'] = true
      const stop = ctx.state['stop'] as number
      const quote = ctx.balances.find((b) => b.asset !== (ctx.symbolInfo?.baseAsset ?? '___'))
      const usdt = quote ? quote.free : 0
      if (stop > 0 && usdt > 0) {
        const qty = ctx.roundQty((usdt / stop) * 0.995)
        if (qty > 0) {
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
    if (ctx.position.qty <= dust) {
      const quote = ctx.balances.find((b) => b.asset !== (ctx.symbolInfo?.baseAsset ?? '___'))
      const usdt = quote ? quote.free : 0
      if (usdt > 0) {
        await ctx.order.market({ side: 'BUY', quoteQty: usdt, reason: 'Arrêt : retour en BTC', tag: 'exit' })
      }
    }
  },
})
