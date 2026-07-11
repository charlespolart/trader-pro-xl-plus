import { defineStrategy, ind, p } from '@tpx/core'

/**
 * BTC VRX Accumulator — accumuler du BTC en vendant les BOUFFÉES DIRECTIONNELLES
 * (variance ratio élevé) hors régime haussier, rachat quand le chemin se
 * recomprime. Second moteur d'accumulation, complémentaire de btc-accumulator :
 * recouvrement des sorties ≈ 27% seulement, corrélation des retours +0,37 —
 * un mix 50/50 garde le rendement en écrasant le drawdown (IS : DD -22% vs -35%).
 *
 * Découverte campagne accum3 (2026-07) : screening de 122 features (dont
 * inventées) × horizons × régimes × {BTC, ETH}, null par décalage circulaire +
 * BH-FDR 10% + réplication ETH exigée → LA famille survivante = micro-structure
 * du chemin : vr(5,60) haut (bouffées) ⇒ retours 5 j faibles/négatifs
 * (quintile Q5 : -1,0%/5j BTC, -1,5% ETH, monotone partout) ; vr bas
 * (compression) ⇒ +2,4%/5j. Journal : apps/backend/src/research/accum3/LOG.md.
 *
 * Mécanique (spot, dénomination BASE, benchmark = garder son BTC = 0%) :
 *   - on détient du BTC par défaut, on ne fait RIEN en bull (prix > EMA200 1d
 *     montante — le gate « tous régimes » est instable, le bull whipsaw) ;
 *   - hors-bull, si vr(5,60) 4h > 1,15 (bouffée) → vendre TOUT le BTC ;
 *   - rachat intégral quand vr < 0,90 (compression) OU si le régime redevient
 *     bull ; cap de perte optionnel (défaut off : neutre en IS, pire exc. -11%).
 *
 * Baselines (défauts, BTCUSDT spot, base, frais OKX 0,10% + slip 0,05%) :
 *   - IS 2018-04→2024-01 : +243,7% BTC, DD -29,1%, 162 tr (81 exc, WR 51%,
 *     payoff 2,1) — moitiés +46/+136, 12/12 départs mensuels positifs,
 *     null timing-aléatoire hors-bull battu au percentile 98,3, coûts ×2 +62%,
 *     plateau des seuils in∈[1,10-1,25]×out∈[0,85-0,95] entièrement positif,
 *     plateau du gate (EMA 150-250 × déclin 15-45) : 9/9 cellules +149..+262%.
 *   - OOS unique 2024-01→2026-07 (figé avant) : +16,9%, DD -19,7%, 38 tr —
 *     3,4× la v2 (+4,9%, DD -25,3%) sur SA fenêtre faible (pas de bear soutenu).
 *     Caveat honnête : percentile null OOS 64 (19 excursions seulement) — la
 *     preuve statistique porte sur l'IS + réplication, l'OOS est cohérent.
 *   - Fenêtres annuelles IS : 8/10 positives (2022 : +150%) ; les pertes sont
 *     des années de recovery en grind (2023 : -18%).
 *   - Grain 4h structurel : 1h -62% (frais), 1d -39% (trop lent) — même carte
 *     de fréquences que la v2.
 *   - ETH : le MÉCANISME réplique (quintiles monotones) mais l'expression
 *     stratégie est BTC-spécifique (ETH +22% DD -60% — pas déployé, cf. X3).
 */
export default defineStrategy({
  name: 'BTC VRX Accumulator',
  description:
    "Accumulation de BTC par vente des bouffées directionnelles (variance ratio 4h > seuil) hors régime haussier, rachat à la recompression. Spot, dénomination BASE. Complément de btc-accumulator (recouvrement 27%).",
  markets: ['spot'],
  symbol: 'BTCUSDT',
  backtest: { denomination: 'base', initialBalance: 1, market: 'spot' },

  params: {
    interval: p.interval({ default: '4h', label: 'Unité de temps (timing)', group: 'Général' }),
    vrAgg: p.int({
      default: 5,
      min: 2,
      max: 20,
      label: 'Agrégation du variance ratio (barres)',
      description: 'Échelle des « bouffées » : var(retours k barres) vs k×var(retours 1 barre).',
      group: 'Variance ratio',
    }),
    vrWindow: p.int({
      default: 60,
      min: 20,
      max: 300,
      label: 'Fenêtre d’estimation (barres)',
      group: 'Variance ratio',
    }),
    thIn: p.number({
      default: 1.15,
      min: 1.0,
      max: 2.0,
      step: 0.05,
      label: 'Seuil de vente (vr >)',
      description: 'Plateau validé 1,10-1,25 (accum3). Plus haut = moins d’excursions, plus sélectif.',
      group: 'Variance ratio',
    }),
    thOut: p.number({
      default: 0.9,
      min: 0.5,
      max: 1.2,
      step: 0.05,
      label: 'Seuil de rachat (vr <)',
      description: 'Plateau validé 0,85-0,95. Doit rester < seuil de vente (hystérésis).',
      group: 'Variance ratio',
    }),

    useGate: p.bool({
      default: true,
      label: 'Ne vendre que hors régime haussier',
      description:
        "Gate de régime : ne vendre que si le prix n'est PAS au-dessus d'une EMA journalière montante. Sans le gate, le bull whipsaw (IS -11% vs +244%).",
      group: 'Régime',
    }),
    gateInterval: p.interval({ default: '1d', label: 'Unité de temps du régime', group: 'Régime' }),
    gateMaLen: p.int({
      default: 200,
      min: 50,
      max: 400,
      label: 'Longueur EMA du régime',
      description: 'Plateau validé 150-250 (9/9 cellules positives avec déclin 15-45).',
      group: 'Régime',
    }),
    gateSlopeBars: p.int({
      default: 30,
      min: 0,
      max: 90,
      label: 'EMA montante depuis N bougies (bull)',
      description: 'Bull = prix > EMA ET EMA plus haute qu’il y a N bougies. 0 = seulement prix > EMA.',
      group: 'Régime',
    }),

    maxLossPct: p.number({
      default: 0,
      min: 0,
      max: 20,
      step: 0.5,
      label: 'Cap de perte par excursion (%)',
      description:
        "0 = off (défaut : neutre en IS, la sortie « vr refroidit » s'auto-limite, pire excursion -11%). Sinon rachat forcé si le prix dépasse la vente de N% (vérifié à la clôture 4h).",
      group: 'Risque',
    }),
  },

  data: (params) => ({
    main: { interval: params.interval },
    gate: { interval: params.gateInterval },
  }),

  init(ctx) {
    return {
      vr: ctx.indicator('main', ind.varianceRatio(ctx.params.vrAgg, ctx.params.vrWindow), { plot: 'pane' }),
      gateMa: ctx.indicator('gate', ind.ema(ctx.params.gateMaLen), { color: '#ff9800' }),
    }
  },

  async onCandle(ctx, feedId, candle) {
    if (feedId !== 'main') return
    const { vr, gateMa } = ctx.locals
    if (!vr.ready) return
    if (ctx.params.useGate && !gateMa.ready) return

    // bull = prix gate > EMA ET EMA montante depuis N bougies gate
    let bull = false
    if (ctx.params.useGate) {
      const gClose = ctx.feed('gate').candles.close(0)
      const ma = gateMa.value
      const maPast = ctx.params.gateSlopeBars === 0 ? null : gateMa.at(ctx.params.gateSlopeBars)
      const rising = ctx.params.gateSlopeBars === 0 || (maPast !== null && ma !== null && maPast < ma)
      bull = gClose !== null && ma !== null && gClose > ma && rising
    }

    const v = vr.value!
    const dust = ctx.symbolInfo?.minQty ?? 1e-8
    const holdingBtc = ctx.position.qty > dust

    if (holdingBtc) {
      // vendre la bouffée directionnelle, uniquement hors-bull
      if (!bull && v > ctx.params.thIn) {
        const qty = ctx.roundQty(ctx.position.qty)
        if (qty <= 0) return
        ctx.state['soldPrice'] = candle.close
        await ctx.order.market({
          side: 'SELL',
          qty,
          reason: `Bouffée directionnelle hors-bull (vr ${v.toFixed(2)} > ${ctx.params.thIn}) → vente du BTC pour rachat à la recompression`,
          tag: 'entry',
        })
      }
      return
    }

    // vendu : racheter à la recompression, au retour du bull, ou au cap de perte
    const sold = (ctx.state['soldPrice'] as number | undefined) ?? candle.close
    const capped = ctx.params.maxLossPct > 0 && candle.close > sold * (1 + ctx.params.maxLossPct / 100)
    if (v < ctx.params.thOut || bull || capped) {
      const quote = ctx.balances.find((b) => b.asset === ctx.symbolInfo?.quoteAsset)
      const usdt = quote ? quote.free : 0
      if (usdt <= 0) return
      const gainPct = ((sold - candle.close) / sold) * 100
      const why = capped
        ? `Cap de perte ${ctx.params.maxLossPct}% touché`
        : bull
          ? 'Retour en régime haussier'
          : `Recompression (vr ${v.toFixed(2)} < ${ctx.params.thOut})`
      await ctx.order.market({
        side: 'BUY',
        quoteQty: usdt,
        reason: `${why} — rachat (vendu ${sold.toFixed(0)} → ${candle.close.toFixed(0)}, ${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(1)}% en BTC)`,
        tag: 'exit',
      })
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
