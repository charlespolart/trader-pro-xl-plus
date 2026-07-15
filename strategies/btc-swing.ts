import { defineStrategy, ind, p } from '@tpx/core'

/**
 * BTC Swing — suivi de tendance spot USD→BTC→USD, holding typique 2-3 jours.
 *
 * Cœur = mécanique er-flow-trend (campagne 2026-06, WF 5/5 fenêtres OOS
 * positives en futures) : régime EMA200 1d, Efficiency Ratio (qualité de
 * tendance), taker-flow (confirmation order-flow), entrée au-dessus de l'EMA
 * locale 4h, sortie au re-croisement (les gagnants courent), stop ATR.
 *
 * Greffes de la campagne day-swing 2026-07 (research/dayswing/LOG.md, D1-D15) :
 *  - stop ATR CAPPÉ à maxLossPct (levier prouvé de l'accumulateur : coupe la
 *    queue des pertes sans toucher au reste) — actif par défaut ;
 *  - entrée MAKER et filtre anti-weekend : DÉFAUT OFF. Testés en ablation 2×2
 *    dans le moteur (D15) : l'avantage maker mesuré à horizon fixe 48h (D13)
 *    S'INVERSE quand les gagnants courent (~130 h de holding moyen) — rater un
 *    runner coûte bien plus que les ~25 bps économisés ; l'anti-weekend rate
 *    des entrées porteuses. Conservés en params pour la passe de sensibilité ;
 *  - fenêtre horaire New York : défaut OFF (artefact de sous-groupe, D9§3/D15).
 *
 * Vague 2 (2026-07-11, D19-D21) : **défaut = entryMode 'donchian'** — cassure du
 * plus-haut de donchLen(55) barres × volume > volMult(1,5)×SMA20, sans ER/flow.
 * Seule config de la campagne à franchir TOUTES les barres pré-enregistrées :
 *  - WF engine 6 fenêtres figé : **+390,0 % OOS composé (5/6)**, 2025 : +2,2 % ;
 *  - **null timing-aveugle apparié : percentile 95,0 = LA barre** (ema : 91) ;
 *  - plateau engine 3×3 (donchLen 40-70 × vol 1,2-2,0) : 9/9 positives,
 *    médiane +474 %, PF 1,75-2,19 ;
 *  - 2019→2026-01 : +474,3 %, PF 1,85, 86 trades (~12/an), DD -40,6 %
 *    (equityPct 60 → -28,6 %, +222,6 %, PF 1,99) ;
 *  - stress coûts ×2 +346 % / ×3 +247 % ; ETH : +277,7 %, PF 1,62 ;
 *  - holdout 2026-01→07 : 0 barre bull → 0 trade quel que soit le mode.
 * entryMode='ema' conserve le comportement validé D15-D16 (+294,4 % WF, p91,
 * DD -31 %) — chiffres et réserves dans dayswing/LOG.md et docs/btc-swing.html.
 * Produit trend-following : WR ~33 %, payoff élevé, dort en USDT hors bull.
 */

/** heure locale New York (règle DST US post-2007) — ancre des effets horaires US */
function nyHour(utcMs: number): number {
  const d = new Date(utcMs)
  const y = d.getUTCFullYear()
  const nthSunday = (month: number, nth: number): number => {
    const first = Date.UTC(y, month, 1)
    const dow = new Date(first).getUTCDay()
    return first + (((7 - dow) % 7) + (nth - 1) * 7) * 86_400_000
  }
  const edt = utcMs >= nthSunday(2, 2) + 7 * 3_600_000 && utcMs < nthSunday(10, 1) + 6 * 3_600_000
  return new Date(utcMs + (edt ? -4 : -5) * 3_600_000).getUTCHours()
}

export default defineStrategy({
  name: 'BTC Swing',
  description:
    'Swing 2-3 jours spot : régime EMA200 1d + Efficiency Ratio + taker-flow, entrée maker sous le signal, stop ATR cappé, sortie au re-croisement EMA. Long-only USDT.',
  markets: ['spot'],
  symbol: 'BTCUSDT',
  backtest: { market: 'spot', denomination: 'quote', initialBalance: 10_000 },

  params: {
    interval: p.interval({ default: '4h', label: 'Unité de temps', group: 'Général' }),
    useHtf: p.bool({ default: true, label: 'Filtre de régime 1d (EMA200)', group: 'Régime' }),

    entryMode: p.select({
      default: 'donchian',
      options: ['ema', 'donchian', 'union'] as const,
      label: "Déclencheur d'entrée",
      description:
        "'ema' = qualité de tendance (ER + flux + prix>EMA) ; 'donchian' = cassure du plus-haut de donchLen barres confirmée par le volume ; 'union' = l'un OU l'autre.",
      group: 'Tendance',
    }),
    donchLen: p.int({ default: 55, min: 20, max: 100, label: 'Canal Donchian (barres)', group: 'Tendance', advanced: true }),
    volMult: p.number({ default: 1.5, min: 1, max: 3, step: 0.1, label: 'Volume mini (× SMA20)', group: 'Tendance', advanced: true }),
    erLen: p.int({ default: 20, min: 5, max: 60, label: 'Période Efficiency Ratio', group: 'Tendance' }),
    erMin: p.number({ default: 0.35, min: 0.1, max: 0.8, step: 0.05, label: 'ER minimum', group: 'Tendance' }),
    emaLen: p.int({ default: 50, min: 10, max: 200, label: 'EMA locale', group: 'Tendance' }),

    useFlowFilter: p.bool({ default: true, label: 'Confirmation taker-flow', group: 'Order-flow' }),
    flowLen: p.int({ default: 10, min: 2, max: 50, label: 'Lissage du flux', group: 'Order-flow' }),

    useMakerEntry: p.bool({ default: false, label: 'Entrée maker (limite sous le signal)', group: 'Exécution' }),
    makerDeltaBps: p.number({ default: 30, min: 5, max: 100, step: 5, label: 'Décote de la limite (bps)', group: 'Exécution' }),
    makerTtlBars: p.int({ default: 2, min: 1, max: 6, label: 'Validité de la limite (barres)', group: 'Exécution' }),
    blockWeekendEntries: p.bool({ default: false, label: 'Pas d’entrée le weekend', group: 'Exécution' }),
    nyWindowOnly: p.bool({ default: false, label: 'Restreindre les entrées à une fenêtre NY', group: 'Exécution', advanced: true }),
    nyFrom: p.int({ default: 21, min: 0, max: 23, label: 'Fenêtre NY : début (h)', group: 'Exécution', advanced: true }),
    nyTo: p.int({ default: 9, min: 0, max: 24, label: 'Fenêtre NY : fin (h)', group: 'Exécution', advanced: true }),

    atrPeriod: p.int({ default: 14, min: 2, max: 100, label: 'Période ATR', group: 'Risque' }),
    atrMult: p.number({ default: 2.5, min: 0.5, max: 6, step: 0.1, label: 'Stop = ATR ×', group: 'Risque' }),
    maxLossPct: p.percent({ default: 4, min: 1, max: 10, label: 'Perte max par trade (cap du stop)', group: 'Risque' }),
    feeMargin: p.number({
      default: 0.999,
      min: 0.98,
      max: 1,
      step: 0.001,
      label: "Part du budget engagée à l'entrée",
      description:
        'OKX spot prélève les frais dans la devise REÇUE (mesuré en réel). 0,999 = marge d’arrondi ; 0,995 sur une venue qui facture en quote.',
      group: 'Risque',
      advanced: true,
    }),
    equityPct: p.percent({ default: 98, min: 10, max: 100, label: 'Part de l’équité par trade', group: 'Risque' }),
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
      donch: ctx.indicator('main', ind.donchian(ctx.params.donchLen), { plot: 'none' }),
      volSma: ctx.indicator('main', ind.sma(20, 'volume'), { plot: 'none' }),
    }
  },

  async onCandle(ctx, feedId, candle) {
    if (feedId !== 'main') return
    const { er, ema, flow, atr, htfEma, donch, volSma } = ctx.locals
    const useEmaSig = ctx.params.entryMode !== 'donchian'
    const useDonchSig = ctx.params.entryMode !== 'ema'
    if (!ema.ready || !atr.ready) return
    if (useEmaSig && (!er.ready || (ctx.params.useFlowFilter && !flow.ready))) return
    if (useDonchSig && (!donch.ready || !volSma.ready)) return
    if (ctx.params.useHtf && !htfEma.ready) return

    const e = ema.value!
    const dust = ctx.symbolInfo?.minQty ?? 0
    const pos = ctx.position.qty
    const holding = pos > dust

    // ---- sortie : re-croisement de l'EMA locale (stop et limite annulés)
    if (holding && candle.close < e) {
      await ctx.order.cancelAll()
      ctx.state['pendingTtl'] = null
      await ctx.order.market({ side: 'SELL', qty: pos, reason: `Clôture sous EMA${ctx.params.emaLen}`, tag: 'exit' })
      return
    }

    // ---- limite d'entrée au repos : décompte de validité
    const ttl = ctx.state['pendingTtl'] as number | null | undefined
    if (ttl != null) {
      if (holding) {
        // remplie (au moins partiellement) : la limite résiduelle expire au même rythme
        if (ttl <= 0) {
          await ctx.order.cancelAll('entry')
          ctx.state['pendingTtl'] = null
        } else ctx.state['pendingTtl'] = ttl - 1
        return
      }
      if (ttl <= 0) {
        await ctx.order.cancelAll('entry')
        ctx.state['pendingTtl'] = null
        ctx.log(`Limite d'entrée expirée (${ctx.params.makerTtlBars} barres) — signal abandonné`)
        // pas de return : on ré-évalue un éventuel nouveau signal sur cette barre
      } else {
        ctx.state['pendingTtl'] = ttl - 1
        return
      }
    }
    if (holding) return

    // ---- signal d'entrée (long only)
    const htfClose = ctx.feed('htf').candles.close(0)
    const trendUp = !ctx.params.useHtf || (htfClose !== null && htfClose > (htfEma.value ?? Number.POSITIVE_INFINITY))
    if (!trendUp) return
    const a = atr.value ?? 0
    if (a <= 0) return
    const erV = er.value ?? 0
    const f = flow.value ?? 0.5
    const emaSig =
      useEmaSig && erV >= ctx.params.erMin && (!ctx.params.useFlowFilter || f > 0.5) && candle.close > e
    const prevUpper = donch.at(1)?.upper ?? null
    const donchSig =
      useDonchSig &&
      prevUpper !== null &&
      candle.close > prevUpper &&
      (volSma.value ?? Infinity) > 0 &&
      candle.volume > ctx.params.volMult * (volSma.value ?? Infinity)
    if (!emaSig && !donchSig) return

    // ---- filtres d'exécution (greffes campagne day-swing)
    const day = new Date(ctx.time).getUTCDay()
    if (ctx.params.blockWeekendEntries && (day === 0 || day === 6)) return
    if (ctx.params.nyWindowOnly) {
      const h = nyHour(ctx.time)
      const inWin = ctx.params.nyFrom <= ctx.params.nyTo ? h >= ctx.params.nyFrom && h < ctx.params.nyTo : h >= ctx.params.nyFrom || h < ctx.params.nyTo
      if (!inWin) return
    }

    const budget = (ctx.equity * ctx.params.equityPct) / 100
    const reasonBase = donchSig
      ? `Régime 1d haussier | cassure du plus-haut ${ctx.params.donchLen} barres (${prevUpper?.toFixed(0)}) | volume ${(candle.volume / (volSma.value || 1)).toFixed(1)}× la moyenne`
      : `Régime 1d haussier | ER ${erV.toFixed(2)} ≥ ${ctx.params.erMin} | flow ${f.toFixed(3)} > 0.5 | prix > EMA${ctx.params.emaLen}`

    if (ctx.params.useMakerEntry) {
      const limitPrice = ctx.roundPrice(candle.close * (1 - ctx.params.makerDeltaBps / 1e4))
      const stop = ctx.roundPrice(Math.max(limitPrice - ctx.params.atrMult * a, limitPrice * (1 - ctx.params.maxLossPct / 100)))
      const qty = ctx.roundQty(budget / limitPrice)
      if (qty <= 0) return
      ctx.state['stop'] = stop
      ctx.state['pendingTtl'] = ctx.params.makerTtlBars
      await ctx.order.limit({
        side: 'BUY',
        qty,
        price: limitPrice,
        reason: `${reasonBase} | limite maker −${ctx.params.makerDeltaBps} bps (${ctx.params.makerTtlBars} barres)`,
        tag: 'entry',
      })
    } else {
      const stop = ctx.roundPrice(Math.max(candle.close - ctx.params.atrMult * a, candle.close * (1 - ctx.params.maxLossPct / 100)))
      ctx.state['stop'] = stop
      // marge d'arrondi (frais d'achat prélevés en BASE sur OKX, mesuré en réel ;
      // la garde pré-trade borne au solde réel)
      await ctx.order.market({ side: 'BUY', quoteQty: budget * ctx.params.feeMargin, reason: reasonBase, tag: 'entry' })
    }
  },

  async onFill(ctx, _fill, order) {
    const dust = ctx.symbolInfo?.minQty ?? 0
    if (order.tag === 'entry' && ctx.position.qty > dust) {
      // ré-arme le stop pour la position TOTALE à chaque fill (les partiels s'additionnent)
      await ctx.order.cancelAll('sl')
      const stop = ctx.state['stop'] as number
      ctx.annotate({ type: 'label', time: ctx.time, price: stop, text: 'SL', color: '#f23645' })
      await ctx.order.stopMarket({
        side: 'SELL',
        qty: ctx.position.qty,
        stopPrice: stop,
        reason: `Stop ATR ×${ctx.params.atrMult} cappé ${ctx.params.maxLossPct}%`,
        tag: 'sl',
      })
    }
    if ((order.tag === 'sl' || order.tag === 'exit') && ctx.position.qty <= dust) {
      ctx.state['pendingTtl'] = null
    }
  },

  async onStop(ctx) {
    await ctx.order.cancelAll()
  },
})
