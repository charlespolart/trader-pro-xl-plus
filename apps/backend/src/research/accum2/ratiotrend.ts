/**
 * RATIO-TREND (recherche) : accumuler du BTC en tradant ETHBTC en long.
 * Détenir BTC par défaut ; acheter ETH quand le ratio casse son plus-haut N
 * jours ; revendre en BTC quand il casse son plus-bas M jours. Dénomination
 * QUOTE (BTC) — le benchmark buy&hold est ETHBTC lui-même, mais l'objectif
 * est le rendement ABSOLU en BTC (être flat = 0%).
 * Complément structurel de la v2 : récolte les phases de surperformance ETH
 * (2020-21) pendant lesquelles l'accumulateur de bear dort.
 */
import { defineStrategy, p } from '@tpx/core'

export const ratioTrend = defineStrategy({
  name: 'Ratio Trend ETHBTC (recherche)',
  description: 'Long ETHBTC sur cassure de plus-haut N j, sortie sur cassure de plus-bas M j. Quote = BTC.',
  markets: ['spot'],
  backtest: { denomination: 'quote', initialBalance: 1, market: 'spot' },
  params: {
    interval: p.interval({ default: '1d', label: 'Unité de temps' }),
    entryLen: p.int({ default: 15, min: 3, max: 120, label: 'Cassure du plus-haut N barres (entrée)' }),
    exitLen: p.int({ default: 5, min: 2, max: 60, label: 'Cassure du plus-bas M barres (sortie)' }),
  },
  data: (params) => ({ main: { interval: params.interval } }),
  init() {
    return {}
  },
  async onCandle(ctx, feedId, candle) {
    if (feedId !== 'main') return
    const s = ctx.feed('main').candles
    const N = ctx.params.entryLen
    const M = ctx.params.exitLen
    if (s.size < Math.max(N, M) + 1) return
    // plus-haut/plus-bas des N/M barres PRÉCÉDENTES (bougie courante exclue)
    let hh = -Infinity
    for (let k = 1; k <= N; k++) hh = Math.max(hh, s.high(k) ?? -Infinity)
    let ll = Infinity
    for (let k = 1; k <= M; k++) ll = Math.min(ll, s.low(k) ?? Infinity)

    const dust = ctx.symbolInfo?.minQty ?? 1e-8
    const holdingEth = ctx.position.qty > dust

    if (!holdingEth && candle.close > hh) {
      const quote = ctx.balances.find((b) => b.asset !== (ctx.symbolInfo?.baseAsset ?? '___'))
      const btc = quote ? quote.free : 0
      if (btc <= 0) return
      await ctx.order.market({
        side: 'BUY',
        quoteQty: btc,
        reason: `Cassure du plus-haut ${N}j (${candle.close.toFixed(5)} > ${hh.toFixed(5)}) → long ETH`,
        tag: 'entry',
      })
    } else if (holdingEth && candle.close < ll) {
      const qty = ctx.roundQty(ctx.position.qty)
      if (qty <= 0) return
      await ctx.order.market({
        side: 'SELL',
        qty,
        reason: `Cassure du plus-bas ${M}j (${candle.close.toFixed(5)} < ${ll.toFixed(5)}) → retour en BTC`,
        tag: 'exit',
      })
    }
  },
  async onStop(ctx) {
    await ctx.order.cancelAll()
    const dust = ctx.symbolInfo?.minQty ?? 1e-8
    if (ctx.position.qty > dust) {
      const qty = ctx.roundQty(ctx.position.qty)
      if (qty > 0) await ctx.order.market({ side: 'SELL', qty, reason: 'Arrêt : retour en BTC', tag: 'exit' })
    }
  },
})
