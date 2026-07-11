import { defineStrategy, ind, p } from '@tpx/core'

/**
 * ETH Accumulator — accumuler de l'ETH, pas de l'USDT.
 *
 * Même mécanique validée que BTC Accumulator (détenir l'actif ; vendre TOUT
 * uniquement en régime franchement baissier ; racheter plus bas au recroisement
 * EMA ; stop ATR plafonné) mais CALIBRÉE POUR ETH (recherche 2026-07,
 * apps/backend/src/research/accum2/LOG.md, entrées X3 et suivantes) :
 *
 *   - PAS de filtre taker-flow (défaut off) : le takerFlow lissé colle à 0,50
 *     au basis-point près et la médiane ETH est à 0,5003 vs 0,4972 pour BTC —
 *     le seuil absolu <0,5 était un fil de rasoir calibré BTC qui bloquait
 *     ~arbitrairement les entrées ETH (vérifié en distribution). Avec le
 *     filtre : +22..97% sur l'IS ; sans : +306..520%.
 *   - erMin 0,45 (vs 0,35 sur BTC) : ETH est plus bruité, on n'accepte que
 *     les tendances très propres. Plateau large (0,40→+359%, 0,45→+489%,
 *     0,50→+359% sur l'IS 2018-04→2024-01).
 *   - confirmation par le régime BTC disponible (confirmMode) : les vrais
 *     bears ETH co-occurrent avec les bears BTC ; les dips idiosyncratiques
 *     d'ETH (rotations alt) sont la source des whipsaws.
 *
 * Chiffres (ETHUSDT spot, dénomination base, frais OKX 0,10% + slip 0,05%) sur
 * l'IS 2018-04→2024-01, par confirmMode : eth +489% (46tr, PF 2,37) ·
 * btc +433% (41tr, PF 2,43) · both +436% (38tr, PF 2,65 — DÉFAUT : moins de
 * trades, meilleure qualité, coupe les dips idiosyncratiques) · off +456%
 * (50tr, PF 2,13). Avec 'both' : deux récoltes INDÉPENDANTES (2018 : +180%
 * quand le prix fait -80% ; 2022 : +76%), ZÉRO trade en bull 2020-21 (dort
 * correctement), 2023 (chop) : -4,6%.
 *
 * ⚠ HONNÊTETÉ (à lire avant de déployer) : le holdout 2024-01→2026-07 n'a
 * aucun bear ETH propre (que du chop en V). La calibration ETH seule
 * (confirmMode='eth') y donne -2% / DD -41% — taxe whipsaw pleine, sans
 * récolte. Les défauts produit ('both') donnent +14,2% / DD -23,8% (14tr) :
 * le co-filtre BTC coupe les dips idiosyncratiques et ne garde que les
 * corrections co-confirmées — positif, mais une seule mesure sans bear, pas
 * encore un OOS réussi. Le mécanisme est validé (mêmes preuves que BTC :
 * 2018+2022, plateau, coûts). C'est une stratégie de BEAR : l'essentiel du
 * gain viendra du prochain marché baissier soutenu.
 *
 * À lancer en backtest avec denomination='base' (capital en ETH). Spot.
 */
export default defineStrategy({
  name: 'ETH Accumulator',
  description:
    "Accumulation d'ETH : vend tout en régime franchement baissier (tendance 3d + confirmation) pour racheter plus bas. Calibré ETH : ER≥0,45, sans filtre de flux. Spot, dénomination BASE.",
  markets: ['spot'],
  symbol: 'ETHUSDT',
  backtest: { denomination: 'base', initialBalance: 1, market: 'spot' },

  params: {
    interval: p.interval({ default: '4h', label: 'Unité de temps (timing)', group: 'Général' }),

    erLen: p.int({ default: 20, min: 5, max: 60, label: 'Période Efficiency Ratio', group: 'Régime baissier' }),
    erMin: p.number({
      default: 0.45,
      min: 0.1,
      max: 0.8,
      step: 0.05,
      label: 'ER minimum',
      description:
        'ETH est plus bruité que BTC : 0,45 (tendances très propres) domine largement 0,35 sur tout le plateau.',
      group: 'Régime baissier',
    }),
    emaLen: p.int({ default: 50, min: 10, max: 200, label: 'EMA locale (vente)', group: 'Régime baissier' }),
    rebuyEmaLen: p.int({ default: 50, min: 10, max: 400, label: 'EMA de rachat', group: 'Régime baissier' }),
    useFlowFilter: p.bool({
      default: false,
      label: 'Confirmation taker-flow',
      description:
        "OFF par défaut sur ETH : le seuil 0,5 est calibré sur la distribution BTC ; sur ETH (médiane 0,5003) il bloque ~arbitrairement les entrées.",
      group: 'Régime baissier',
    }),
    flowLen: p.int({ default: 10, min: 2, max: 50, label: 'Lissage du flux', group: 'Régime baissier' }),

    useTrend: p.bool({ default: true, label: 'Filtre de tendance générale', group: 'Tendance générale' }),
    trendInterval: p.interval({ default: '3d', label: 'Unité de temps de la tendance', group: 'Tendance générale' }),
    trendMaLen: p.int({ default: 60, min: 10, max: 400, label: 'Longueur de la MA de tendance', group: 'Tendance générale' }),
    trendSlopeBars: p.int({ default: 8, min: 0, max: 90, label: 'MA de tendance en déclin depuis N bougies', group: 'Tendance générale' }),

    confirmMode: p.select({
      default: 'both',
      options: ['eth', 'btc', 'both', 'off'] as const,
      label: 'Confirmation lente (2ᵉ TF)',
      description:
        "Quel régime journalier doit AUSSI être baissier pour autoriser la vente. 'both' (défaut) = ETH ET BTC — les vrais bears ETH co-occurrent avec les bears BTC, exiger les deux filtre les dips idiosyncratiques (rotations alt) qui whipsawent.",
      group: 'Confirmation 2ᵉ TF',
    }),
    confirmMaLen: p.int({ default: 200, min: 10, max: 400, label: 'Longueur MA de confirmation (1d)', group: 'Confirmation 2ᵉ TF' }),
    confirmSlopeBars: p.int({ default: 30, min: 0, max: 90, label: 'MA de confirmation en déclin depuis N jours', group: 'Confirmation 2ᵉ TF' }),

    atrPeriod: p.int({ default: 14, min: 2, max: 100, label: 'Période ATR', group: 'Risque' }),
    stopAtrMult: p.number({ default: 2.5, min: 0.5, max: 8, step: 0.1, label: 'Stop = ATR ×', group: 'Risque' }),
    maxLossPct: p.number({ default: 5, min: 0, max: 20, step: 0.5, label: 'Perte max par trade (%)', group: 'Risque' }),
  },

  data: (params) => ({
    main: { interval: params.interval },
    trend: { interval: params.trendInterval },
    confirmEth: { interval: '1d' },
    confirmBtc: { interval: '1d', symbol: 'BTCUSDT' },
  }),

  init(ctx) {
    return {
      er: ctx.indicator('main', ind.efficiencyRatio(ctx.params.erLen), { plot: 'pane' }),
      ema: ctx.indicator('main', ind.ema(ctx.params.emaLen), { color: '#ff9800' }),
      rebuyEma: ctx.indicator('main', ind.ema(ctx.params.rebuyEmaLen), {
        plot: ctx.params.rebuyEmaLen === ctx.params.emaLen ? 'none' : 'overlay',
        color: '#26a69a',
      }),
      flow: ctx.indicator('main', ind.takerFlow(ctx.params.flowLen), { plot: 'none' }),
      atr: ctx.indicator('main', ind.atr(ctx.params.atrPeriod), { plot: 'none' }),
      trendMa: ctx.indicator('trend', ind.ema(ctx.params.trendMaLen), { plot: 'none' }),
      confirmEthMa: ctx.indicator('confirmEth', ind.ema(ctx.params.confirmMaLen), { plot: 'none' }),
      confirmBtcMa: ctx.indicator('confirmBtc', ind.ema(ctx.params.confirmMaLen), { plot: 'none' }),
    }
  },

  async onCandle(ctx, feedId, candle) {
    if (feedId !== 'main') return
    const { er, ema, rebuyEma, flow, atr, trendMa, confirmEthMa, confirmBtcMa } = ctx.locals
    if (!er.ready || !ema.ready || !rebuyEma.ready || !atr.ready || (ctx.params.useFlowFilter && !flow.ready)) return
    if (ctx.params.useTrend && !trendMa.ready) return
    const mode = ctx.params.confirmMode
    if ((mode === 'eth' || mode === 'both') && !confirmEthMa.ready) return
    if ((mode === 'btc' || mode === 'both') && !confirmBtcMa.ready) return

    const e = ema.value!
    const a = atr.value ?? 0
    const dust = ctx.symbolInfo?.minQty ?? 1e-8
    const holdingEth = ctx.position.qty > dust

    if (holdingEth) {
      // ---- on détient de l'ETH : vendre UNIQUEMENT en régime franchement baissier
      const trendClose = ctx.feed('trend').candles.close(0)
      const belowTrendMa = trendClose !== null && trendClose < (trendMa.value ?? 0)
      const slopeOk =
        ctx.params.trendSlopeBars === 0 ||
        (trendMa.value !== null && (trendMa.at(ctx.params.trendSlopeBars) ?? Infinity) > trendMa.value)
      const trendBear = !ctx.params.useTrend || (belowTrendMa && slopeOk)

      const bearOf = (feed: 'confirmEth' | 'confirmBtc', ma: typeof confirmEthMa): boolean => {
        const close = ctx.feed(feed).candles.close(0)
        const below = close !== null && close < (ma.value ?? 0)
        const slope =
          ctx.params.confirmSlopeBars === 0 ||
          (ma.value !== null && (ma.at(ctx.params.confirmSlopeBars) ?? Infinity) > ma.value)
        return below && slope
      }
      const confirmBear =
        mode === 'off'
          ? true
          : mode === 'eth'
            ? bearOf('confirmEth', confirmEthMa)
            : mode === 'btc'
              ? bearOf('confirmBtc', confirmBtcMa)
              : bearOf('confirmEth', confirmEthMa) && bearOf('confirmBtc', confirmBtcMa)

      const cleanTrend = er.value! >= ctx.params.erMin
      const f = flow.value ?? 0.5
      const sellingFlow = !ctx.params.useFlowFilter || f < 0.5
      const belowEma = candle.close < e

      if (trendBear && confirmBear && cleanTrend && sellingFlow && belowEma && a > 0) {
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
          reason: `Régime baissier (tendance ${ctx.params.trendInterval} en déclin, confirm ${mode}, ER ${er.value!.toFixed(2)}, prix < EMA${ctx.params.emaLen}) → vente de l'ETH pour rachat plus bas`,
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
        reason: `Rachat sur recroisement EMA${ctx.params.rebuyEmaLen} (vendu ${sold.toFixed(0)} → rachat ${candle.close.toFixed(0)}, ${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(1)}% en ETH)`,
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
            reason: `Stop : le prix est remonté de ${ctx.params.stopAtrMult}×ATR → rachat pour limiter la perte d'ETH`,
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
    // Arrêter le bot ne transige JAMAIS : on annule seulement les ordres
    // résidents. Si le bot était en excursion (vendu), il reste en USDT — la
    // reprise le rachètera au signal, ou l'utilisateur ajuste à la main.
    await ctx.order.cancelAll()
  },
})
