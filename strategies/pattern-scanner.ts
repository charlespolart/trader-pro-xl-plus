import { ALL_PATTERNS, candlePatterns, defineStrategy, p, type PatternName } from '@tpx/core'

/**
 * Scanner de patterns — NE TRADE JAMAIS.
 * Outil de vérification : lance un backtest avec le pattern de ton choix (ou
 * tous), et inspecte les détections sur la chart du résultat (avec le replay
 * bougie par bougie si besoin). Le décompte par pattern est loggé à la fin.
 *
 * Pour une itération plus rapide sans backtest, utilise la page « Patterns »
 * de l'UI (mêmes détecteurs, navigation détection par détection).
 */
export default defineStrategy({
  name: 'Pattern Scanner (aucun trade)',
  description: 'Affiche les détections de patterns sur la chart sans jamais trader — outil de vérification visuelle.',
  markets: ['spot', 'futures'],

  params: {
    interval: p.interval({ default: '1h', label: 'Unité de temps' }),
    pattern: p.select({
      options: ['tous', ...ALL_PATTERNS],
      default: 'tous',
      label: 'Pattern à scanner',
    }),
    requireTrend: p.bool({ default: true, label: 'Contexte de tendance requis' }),
    strictColor: p.bool({
      default: false,
      label: 'Couleur stricte (famille marteau)',
      description: 'Hammer vert / hanging man rouge obligatoires — non canonique mais conforme aux fiches simplifiées',
    }),
    trendMinPct: p.number({ default: 0.8, min: 0.1, max: 5, step: 0.1, label: 'Tendance min (%)' }),
  },

  init(ctx) {
    const names =
      ctx.params.pattern === 'tous' || !(ALL_PATTERNS as string[]).includes(ctx.params.pattern)
        ? undefined
        : [ctx.params.pattern as PatternName]
    return {
      pat: ctx.indicator(
        'main',
        candlePatterns(names, {
          requireTrend: ctx.params.requireTrend,
          strictColor: ctx.params.strictColor,
          trendMinPct: ctx.params.trendMinPct,
        }),
      ),
    }
  },

  onCandle(ctx, feedId) {
    if (feedId !== 'main') return
    const v = ctx.locals.pat.value
    if (!v) return
    for (const [name, dir] of Object.entries(v)) {
      if (dir === 0) continue
      const counts = (ctx.state['counts'] as Record<string, number> | undefined) ?? {}
      counts[name] = (counts[name] ?? 0) + 1
      ctx.state['counts'] = counts
    }
  },

  onStop(ctx) {
    const counts = (ctx.state['counts'] as Record<string, number> | undefined) ?? {}
    const lines = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([n, c]) => `${n}: ${c}`)
    ctx.log(lines.length > 0 ? `Détections — ${lines.join(', ')}` : 'Aucune détection sur la plage')
  },
})
