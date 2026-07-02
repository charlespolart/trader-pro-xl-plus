/**
 * Stratégie recherche : v2 avec tendance 3d RESAMPLÉE du 1d, phase 0/1/2.
 * (offset=1 = grille native Binance). Voir phase3d.ts pour le protocole.
 */
import { defineStrategy, ind, p } from '@tpx/core'

const DAY = 86_400_000

/** état du resampler 1d→3d + EMA (amorce SMA, convention du repo) */
interface Resampler {
  seedSum: number
  seedCount: number
  ema: number | null
  hist: number[]
  lastClose: number | null
  /** nb de bougies htf déjà consommées depuis la série (rattrapage warmup) */
  processed: number
}

export const phaseStrategy = defineStrategy({
  name: 'v2 phase-test (trend 3d resamplée du 1d)',
  description: 'Réplique v2 avec bougies 3d reconstruites du 1d, offset de phase 0/1/2.',
  markets: ['spot'],
  backtest: { denomination: 'base', initialBalance: 1, market: 'spot' },
  params: {
    interval: p.interval({ default: '4h', label: 'TF timing' }),
    phaseOffset: p.int({ default: 1, min: 0, max: 2, label: 'Phase de la grille 3d (1 = native)' }),
    erLen: p.int({ default: 20, min: 5, max: 60, label: 'ER' }),
    erMin: p.number({ default: 0.35, min: 0.1, max: 0.8, step: 0.05, label: 'ER min' }),
    emaLen: p.int({ default: 50, min: 10, max: 200, label: 'EMA vente' }),
    rebuyEmaLen: p.int({ default: 50, min: 10, max: 400, label: 'EMA rachat' }),
    useFlowFilter: p.bool({ default: true, label: 'Flow' }),
    flowLen: p.int({ default: 10, min: 2, max: 50, label: 'Flow len' }),
    trendMaLen: p.int({ default: 60, min: 10, max: 400, label: 'EMA tendance (buckets 3d)' }),
    trendSlopeBars: p.int({ default: 8, min: 0, max: 90, label: 'Déclin (buckets 3d)' }),
    useConfirm: p.bool({ default: true, label: 'Double confirmation' }),
    confirmMaLen: p.int({ default: 200, min: 10, max: 400, label: 'EMA confirm (1d)' }),
    confirmSlopeBars: p.int({ default: 30, min: 0, max: 90, label: 'Déclin confirm (j)' }),
    atrPeriod: p.int({ default: 14, min: 2, max: 100, label: 'ATR' }),
    stopAtrMult: p.number({ default: 2.5, min: 0.5, max: 8, step: 0.1, label: 'Stop ATR×' }),
    maxLossPct: p.number({ default: 5, min: 0, max: 20, step: 0.5, label: 'Perte max %' }),
  },
  data: (params) => ({ main: { interval: params.interval }, htf: { interval: '1d' } }),
  init(ctx) {
    const rs: Resampler = { seedSum: 0, seedCount: 0, ema: null, hist: [], lastClose: null, processed: 0 }
    return {
      er: ctx.indicator('main', ind.efficiencyRatio(ctx.params.erLen), { plot: 'none' }),
      ema: ctx.indicator('main', ind.ema(ctx.params.emaLen), { plot: 'none' }),
      rebuyEma: ctx.indicator('main', ind.ema(ctx.params.rebuyEmaLen), { plot: 'none' }),
      flow: ctx.indicator('main', ind.takerFlow(ctx.params.flowLen), { plot: 'none' }),
      atr: ctx.indicator('main', ind.atr(ctx.params.atrPeriod), { plot: 'none' }),
      confirmMa: ctx.indicator('htf', ind.ema(ctx.params.confirmMaLen), { plot: 'none' }),
      rs,
    }
  },
  async onCandle(ctx, feedId, candle) {
    const { er, ema, rebuyEma, flow, atr, confirmMa, rs } = ctx.locals as {
      er: { ready: boolean; value: number | null }
      ema: { ready: boolean; value: number | null }
      rebuyEma: { ready: boolean; value: number | null }
      flow: { ready: boolean; value: number | null }
      atr: { ready: boolean; value: number | null }
      confirmMa: { ready: boolean; value: number | null; at(n: number): number | null }
      rs: Resampler
    }

    // ---- resampling 1d → buckets 3d à phase paramétrable. IMPORTANT : les
    // hooks sont suppressés pendant le warmup, mais la SÉRIE htf, elle, est
    // remplie — on rattrape donc depuis la série (rs.processed = curseur), ce
    // qui donne au resampler le même historique que les BoundIndicators.
    // Un bucket = jours [offset+3k, offset+3k+2], il clôt au close du 3ᵉ jour
    // — même timing d'information que la bougie 3d native.
    {
      const s = ctx.feed('htf').candles
      while (rs.processed < s.size) {
        const c = s.at(s.size - 1 - rs.processed)!
        rs.processed++
        const dayIdx = Math.floor(c.openTime / DAY)
        if ((((dayIdx - ctx.params.phaseOffset) % 3) + 3) % 3 !== 2) continue
        const x = c.close
        const period = ctx.params.trendMaLen
        if (rs.ema === null) {
          rs.seedSum += x
          rs.seedCount++
          if (rs.seedCount >= period) rs.ema = rs.seedSum / period
        } else {
          const alpha = 2 / (period + 1)
          rs.ema = alpha * x + (1 - alpha) * rs.ema
        }
        if (rs.ema !== null) rs.hist.push(rs.ema)
        rs.lastClose = x
      }
    }
    if (feedId !== 'main') return
    if (!er.ready || !ema.ready || !rebuyEma.ready || !atr.ready || (ctx.params.useFlowFilter && !flow.ready)) return
    if (rs.ema === null) return
    if (ctx.params.useConfirm && !confirmMa.ready) return

    const e = ema.value!
    const a = atr.value ?? 0
    const dust = ctx.symbolInfo?.minQty ?? 1e-8
    const holdingBtc = ctx.position.qty > dust

    if (holdingBtc) {
      const belowTrendMa = rs.lastClose !== null && rs.lastClose < rs.ema
      const n = ctx.params.trendSlopeBars
      const past = rs.hist.length - 1 - n >= 0 ? rs.hist[rs.hist.length - 1 - n]! : Infinity
      const slopeOk = n === 0 || past > rs.ema
      const trendBear = belowTrendMa && slopeOk
      const confirmClose = ctx.feed('htf').candles.close(0)
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
        await ctx.order.market({ side: 'SELL', qty, reason: 'bear (phase-test)', tag: 'entry' })
      }
      return
    }

    if (candle.close > rebuyEma.value!) {
      await ctx.order.cancelAll()
      const quote = ctx.balances.find((b) => b.asset !== (ctx.symbolInfo?.baseAsset ?? '___'))
      const usdt = quote ? quote.free : 0
      if (usdt <= 0) return
      await ctx.order.market({ side: 'BUY', quoteQty: usdt, reason: 'rachat (phase-test)', tag: 'exit' })
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
          await ctx.order.stopMarket({ side: 'BUY', qty, stopPrice: stop, reason: 'stop', tag: 'sl' })
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
      if (usdt > 0) await ctx.order.market({ side: 'BUY', quoteQty: usdt, reason: 'fin', tag: 'exit' })
    }
  },
})

