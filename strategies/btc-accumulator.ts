import { defineStrategy, ind, p } from '@tpx/core'

/**
 * BTC Accumulator — accumuler du BTC, pas de l'USDT. (ex « v2 », promue
 * stratégie unique BTC en 2026-07 ; la v1 et la v3-fractionnée sont archivées
 * dans apps/backend/src/research/accum2/legacy/.)
 *
 * Philosophie : on DÉTIENT du BTC par défaut, on ne fait RIEN en régime
 * haussier. Uniquement quand le marché est franchement baissier, on vend tout
 * le BTC contre USDT et on le rachète plus bas → plus de BTC à la fin.
 *
 * Détection du régime : tendance générale lue sur une UNITÉ DE TEMPS DÉDIÉE
 * (trendInterval, défaut 3d — EMA60 en déclin depuis 8 bougies) AVEC double
 * confirmation journalière (EMA200 1d en déclin 30 j = le filtre historique de
 * la v1) ; timing des entrées/sorties sur le 4 h (ER + EMA50 + taker-flow),
 * stop ATR×2,5 plafonné à 5 % de perte, rachat au recroisement EMA.
 *
 * À lancer en backtest avec denomination='base' (capital en BTC). Spot.
 *
 * ⚠ RÉVISION 2026-07 : les chiffres de juin étaient calculés sur des données
 * 3d TROUÉES (les ZIPs mensuels Vision omettent la bougie qui chevauche la fin
 * de mois — 21 bougies manquantes dont tout janvier 2025 ; réparé + candleStore
 * corrigé pour agréger 3d/1w depuis le 1d). Chiffres ci-dessous = données
 * complètes, frais OKX (taker 0,10% + slippage 0,05%), journal complet dans
 * apps/backend/src/research/accum2/LOG.md.
 *
 * Baselines (défauts, BTCUSDT spot, base) :
 *   - 2019-01→2026-06 : +61,9% BTC, DD -29,6%, 57 trades (WR 32%, payoff 3,5:1)
 *   - 2020-08→2026-06 : +112,5%, DD -28,0%, 49 trades
 *   - full 2018-04→2026-07 : +126,2%, DD -32,5%, 65 trades
 *   - WF configs figées, 8 tranches OOS 2018→2026 : +77,6% composé (4/8) vs
 *     v1 +74,0% (3/8) — l'avantage du TF 3d sur le 1d est réel mais MINCE.
 *     Ne PAS ré-optimiser trendInterval en refit (nuit, vérifié 2×).
 *
 * VALIDATION (2026-07, la plus forte à ce jour) :
 *   - bear 2018 en pseudo-OOS (données jamais utilisées à la conception) :
 *     +46,5% pendant que le prix fait -59% (PF 12, pire trade -3%) — zéro réglage ;
 *   - robuste au déphasage des bougies 3d (les 3 phases du calendrier positives) ;
 *   - coûts ×2 → +36%/+83% ; 26/26 dates de départ mensuelles positives ;
 *   - null « timing aveugle » : excursions aléatoires de mêmes durées dans le
 *     même régime bear → médiane -22% ; capture parfaite du régime → +11,6% ;
 *     la v2 → +120% = percentile 97. ⇒ L'EDGE EST LA MÉCANIQUE D'EXCURSION
 *     (stop cappé 5% / rachat recross rapide / ré-entrée sur faiblesse), le
 *     régime n'est que le contexte. Toutes les variantes d'exit testées
 *     (trailing, ladder, min-hold), tous les filtres d'entrée (funding, vol,
 *     distance ATH, âge du bear, sessions) et le sizing pondéré sont PIRES ou
 *     nuls — le cœur v2 défauts est un optimum local (grain 4h validé aussi).
 *
 * DOUBLE CONFIRMATION (useConfirm, défaut ON) — anti-drawdown : le 3d seul
 * whipsaw dans les corrections de bull (vendre puis V-recovery) → 2019→2026
 * +31,1% / -44,8% DD. Exiger qu'un 2ᵉ TF plus lent (journalier, EMA200 déclin
 * 30j = le filtre v1) soit AUSSI baissier coupe ces faux signaux : +61,9% /
 * -29,6% (rendement ×2 ET -15 pts de DD ; le bear 2022 intact). En walk-forward
 * récent c'est ~neutre → filtre de sécurité non sur-ajusté : protège quand le
 * danger est là (2019-20), ne dégrade pas sinon.
 *
 * Réglages selon l'unité de temps de tendance (l'EMA a besoin de ~trendMaLen
 * bougies pour être prête) :
 *   - 3d : trendMaLen 60-70, trendSlopeBars 6-8  (DÉFAUT, validé sur le plateau)
 *   - 1d : trendMaLen 200, trendSlopeBars 30     (= équivalent v1)
 *   - 1w : trendMaLen 40-50, trendSlopeBars 4-6
 * Une EMA200 sur 1w demanderait ~4 ans de données pour être prête → inadapté.
 */
export default defineStrategy({
  name: 'BTC Accumulator',
  description:
    "Accumulation de BTC : tendance générale sur un TF dédié (3d par défaut) avec double confirmation journalière (anti-drawdown). Spot, dénomination BASE.",
  markets: ['spot'],
  symbol: 'BTCUSDT',
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
      const quote = ctx.balances.find((b) => b.asset === ctx.symbolInfo?.quoteAsset)
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
      const quote = ctx.balances.find((b) => b.asset === ctx.symbolInfo?.quoteAsset)
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
      const quote = ctx.balances.find((b) => b.asset === ctx.symbolInfo?.quoteAsset)
      const usdt = quote ? quote.free : 0
      if (usdt > 0) {
        await ctx.order.market({ side: 'BUY', quoteQty: usdt, reason: 'Arrêt : retour en BTC', tag: 'exit' })
      }
    }
  },
})
