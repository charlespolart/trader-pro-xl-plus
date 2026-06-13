# Écrire une stratégie

Les stratégies sont des fichiers TypeScript dans `strategies/`, avec un export par défaut créé par `defineStrategy()`. **Le même code tourne en backtest, en paper, en testnet et en live** — le moteur garantit l'absence de lookahead par construction : un ordre n'est jamais exécuté contre des données antérieures à sa soumission, et les ordres market sont remplis sur la bougie/le trade *suivant*.

## Squelette

```ts
import { crossover, defineStrategy, ind, p } from '@tpx/core'

export default defineStrategy({
  name: 'Ma Stratégie',
  description: 'Ce qu’elle fait, en une phrase.',
  markets: ['spot', 'futures'],          // marchés supportés

  params: {
    interval: p.interval({ default: '15m', label: 'Unité de temps' }),
    emaLen:   p.int({ default: 200, min: 10, max: 500, group: 'Entrée' }),
    riskPct:  p.percent({ default: 1, min: 0.1, max: 10, group: 'Risque' }),
  },

  // facultatif si un param `interval` existe (main feed implicite)
  data: (params) => ({
    main: { interval: params.interval },             // OBLIGATOIRE: feed 'main' sur la paire tradée
    htf:  { interval: '4h' },                        // multi-timeframe
    btc:  { symbol: 'BTCUSDT', interval: '1h' },     // multi-paires (lecture seule)
    flow: { trades: true },                          // aggTrades → hook onTrade
  }),

  init(ctx) {
    // Enregistrer les indicateurs ICI (uniquement ici), et retourner les
    // handles : ils deviennent ctx.locals, typés, dans tous les hooks.
    return {
      ema: ctx.indicator('main', ind.ema(ctx.params.emaLen)),          // overlay auto
      rsi: ctx.indicator('main', ind.rsi(14), { plot: 'pane' }),       // pane séparée
      atr: ctx.indicator('main', ind.atr(14), { plot: 'none' }),       // pas sur la chart
    }
  },

  async onCandle(ctx, feedId, candle) {
    if (feedId !== 'main') return
    const { ema, rsi, atr } = ctx.locals
    if (!ema.ready || !rsi.ready) return
    // ... logique
  },
})
```

## Paramètres (`p.*`)

Chaque paramètre est déclaré avec métadonnées → l'UI génère le formulaire de configuration, et l'optimiseur peut balayer les valeurs.

| Builder | Type TS | Options |
|---|---|---|
| `p.int({ default, min?, max?, step? })` | `number` | arrondi à l'entier |
| `p.number({ ... })` | `number` | |
| `p.percent({ ... })` | `number` | sucre pour un nombre en % |
| `p.bool({ default })` | `boolean` | |
| `p.select({ options: ['a','b'], default })` | union littérale | |
| `p.interval({ default, options? })` | `Interval` | unités de temps |
| `p.string({ default })` | `string` | |

Communs : `label`, `description`, `group` (sections du formulaire), `advanced`.
`ctx.params` est **entièrement typé** depuis ce schéma.

## Le contexte (`ctx`)

| Membre | Description |
|---|---|
| `ctx.mode` | `'backtest' \| 'paper' \| 'testnet' \| 'live'` |
| `ctx.market`, `ctx.symbol` | marché et paire tradés |
| `ctx.time` | horodatage courant (ms) |
| `ctx.price` | dernier prix connu |
| `ctx.candles` | historique du feed `main` (`CandleSeries`) |
| `ctx.feed(id)` | accès aux autres feeds : `ctx.feed('htf').candles.close(0)` |
| `ctx.locals` | objet retourné par `init()` (handles d'indicateurs…) — **non persisté** |
| `ctx.state` | état JSON persistant (survit aux redémarrages en live) |
| `ctx.position` | position courante (qty signée : short < 0 en futures) |
| `ctx.equity`, `ctx.balances` | équité du bot, soldes |
| `ctx.order.*` | passage d'ordres (voir plus bas) |
| `ctx.risk.*` | helpers de sizing |
| `ctx.annotate(a)` | dessiner sur la chart (marker, hline, label) |
| `ctx.log/debug/warn` | journal (visible dans l'UI et le résultat de backtest) |
| `ctx.roundPrice/roundQty` | arrondi aux filtres de l'exchange |
| `ctx.halt(reason)` | arrête le bot/backtest depuis la stratégie |

### Indexation lookback (style Pine)

`series.close(0)` = bougie courante (clôturée), `close(1)` = précédente.
Pareil pour les indicateurs : `rsi.at(0)`, `rsi.at(1)`… `rsi.value ≡ rsi.at(0)`.

### Helpers TA

```ts
crossover(a, b)   // a croise au-dessus de b sur la dernière bougie (b: série ou nombre)
crossunder(a, b)
rising(a, n)      // strictement croissant sur n bougies
falling(a, n)
```

Les handles mono-sortie sont des séries. Multi-sorties : `macdH.out('hist')`.

## Indicateurs

Intégrés (`ind.*`) : `sma, ema, wma, hma, vwap, rollingVwap, rsi, macd, stoch, stochRsi, cci, mfi, obv, roc, willr, atr, bbands, keltner, donchian, adx, supertrend, psar`.

La plupart acceptent une source : `'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4' | 'volume'` ou une fonction `(c: Candle) => number`.

### Indicateur custom

```ts
import { defineIndicator, emaStream } from '@tpx/core'

const myMomentum = (len: number) =>
  defineIndicator({
    id: `mymom(${len})`,
    warmup: len + 1,
    defaultPlot: 'pane',
    create: () => {
      const smooth = emaStream(len)
      let prev: number | null = null
      return (candle) => {
        const x = candle.close * candle.volume
        const out = prev === null ? null : smooth(x - prev)
        prev = x
        return out
      }
    },
  })

// init: ctx.indicator('main', myMomentum(20))
```

Le calcul est **incrémental** (une bougie clôturée → une valeur) : c'est ce qui rend le live et le backtest rigoureusement identiques. Primitives disponibles : `smaStream, emaStream, rmaStream, wmaStream, stddevStream, highestStream, lowestStream, lagStream`. Multi-sorties : retournez un objet et déclarez `outputs: ['a','b']`.

## Patterns de chandeliers japonais

`candlePatterns()` détecte ~30 patterns classiques (doji et variantes, hammer/hanging man, marubozu, spinning tops, kickers, engulfing, piercing/dark cloud, tweezers, harami, morning/evening star, abandoned baby, three soldiers/crows, three inside/outside, three line strike, windows) comme un indicateur standard :

```ts
import { bullishSignals, candlePatterns } from '@tpx/core'

init(ctx) {
  return {
    // sorties typées : pat.value.hammer ∈ {1, 0} ; les baissiers émettent -1
    pat: ctx.indicator('main', candlePatterns(['hammer', 'bullishEngulfing', 'morningStar'])),
  }
},
onCandle(ctx) {
  const signaux = bullishSignals(ctx.locals.pat.value)   // ex: ['hammer']
  if (signaux.length > 0) { /* ... */ }
}
```

- **Affichage automatique** : `plot: 'markers'` par défaut — chaque détection apparaît comme une flèche nommée sur la chart (vert = haussier, rouge = baissier). `{ plot: 'none' }` pour un usage silencieux.
- **Contexte de tendance** : les définitions classiques sont respectées (un *hammer* exige une baisse préalable ; la même bougie après une hausse est un *hanging man*). Réglable via `trendLookback` / `trendMinPct`, désactivable avec `{ requireTrend: false }`.
- **Couleur du corps (famille marteau)** : conformément aux références (Nison, StockCharts ChartSchool, Wikipedia), la couleur n'est **pas** un critère pour hammer / inverted hammer / hanging man / shooting star — c'est la forme et le contexte qui définissent le pattern, un corps vert n'étant qu'un signal légèrement plus fort. Certaines fiches simplifiées (wikiHow…) imposent la couleur : `{ strictColor: true }` pour les suivre (hammer/inverted verts, hanging man/shooting star rouges).
- **Gaps canoniques** : les définitions textbook exigent des gaps (piercing line ouvre **sous le plus bas** précédent, dark cloud **au-dessus du plus haut**, corps de l'étoile en gap pour morning/evening star). Quasi impossibles en crypto 24/7 (l'open ≈ la clôture précédente), donc la version adaptée est le défaut ; `{ strictGaps: true }` applique le canon au mot près.
- **Three line strike** : nommage **Bulkowski** (thepatternsite.com), par la tendance des trois premières bougies — *bullish* = 3 blanches montantes avalées par une grande noire (théorie : continuation haussière), *bearish* = symétrique. Attention : Bulkowski mesure ~65 % de comportements de **retournement** malgré le nom — backtester avant usage.
- **Indicateurs techniques vérifiés** : la suite `test/reference.test.ts` valide chaque indicateur contre une implémentation textbook indépendante (erreur relative < 1e-9, indices de warmup identiques). Conventions suivies : EMA amorcée SMA (TA-Lib), lissage de Wilder pour RSI/ATR/ADX, écart-type de population pour Bollinger (Pine `biased=true`), stochastique lent, PSAR canonique de Wilder (clamp deux bougies).
- **Seuils relatifs configurables** (`PatternOptions`) : taille de corps doji, ratio des mèches, tolérance d'égalité des tweezers…
- `candlePatterns()` sans argument détecte tout ; `BULLISH_PATTERNS` / `BEARISH_PATTERNS` listent les noms par direction.
- Adaptations crypto : pas de gaps en 24/7 → piercing line / dark cloud assouplis (pas d'exigence de gap d'ouverture), windows et abandoned baby quasi muets sur les paires liquides.
- **Non couvert (phase 2)** : patterns structurels multi-bougies (double top/bottom, cup & handle, wedge, flag) — ils nécessitent un moteur de pivots/zigzag.

**Vérifier visuellement les détecteurs** : la page **Patterns** de l'UI scanne n'importe quelle plage (paire/intervalle/période) et permet de naviguer détection par détection sur la chart — mêmes détecteurs et mêmes seuils que dans les stratégies. Pour le workflow backtest (avec replay), la stratégie `pattern-scanner` détecte un pattern au choix sans jamais trader.

Exemple complet : `strategies/pattern-reversal.ts`.

## Ordres

```ts
await ctx.order.market({ side: 'BUY', qty })                  // ou quoteQty
await ctx.order.limit({ side: 'BUY', qty, price, postOnly? })
await ctx.order.stopMarket({ side: 'SELL', qty, stopPrice })
await ctx.order.stopLimit({ side: 'SELL', qty, stopPrice, price })
await ctx.order.takeProfitMarket({ side: 'SELL', qty, stopPrice })
await ctx.order.cancel(orderId)
await ctx.order.cancelAll('sl')      // par tag, ou tout si omis
ctx.order.open                       // ordres ouverts
```

Champs utiles sur chaque ordre :
- **`reason`** : texte libre — c'est lui qui répond à « pourquoi le bot a acheté » dans l'UI et le journal des trades. Mettez-y la condition réelle (valeurs comprises).
- **`tag`** : étiquette machine (`'entry'`, `'sl'`, `'tp'`…) pour `cancelAll(tag)` et le suivi.
- **`ocoGroup`** : les ordres d'un même groupe s'annulent mutuellement quand l'un s'exécute → brackets SL/TP uniformes spot + futures :

```ts
await ctx.order.stopMarket({ side: 'SELL', qty, stopPrice: sl, ocoGroup: 'exit', tag: 'sl', reduceOnly: true })
await ctx.order.takeProfitMarket({ side: 'SELL', qty, stopPrice: tp, ocoGroup: 'exit', tag: 'tp', reduceOnly: true })
```

- **`reduceOnly`** (futures) : ne peut jamais augmenter la position. Ignoré sur spot.

### Sizing

```ts
// risque R classique : perdre riskPct% de l'équité si le stop est touché
const qty = ctx.risk.sizeByRisk({ entry: ctx.price, stop, riskPct: 1 })
// notional = pct% de l'équité (× levier en futures)
const qty2 = ctx.risk.sizeByEquityPct(25)
```

## Hooks

| Hook | Déclencheur |
|---|---|
| `init(ctx)` | au démarrage — enregistrer les indicateurs, retourner `locals` |
| `onCandle(ctx, feedId, candle)` | chaque bougie **clôturée**, par feed, en ordre chronologique |
| `onTrade(ctx, feedId, trade)` | chaque aggTrade des feeds `trades: true` |
| `onFill(ctx, fill, order)` | chaque exécution (y compris partielle) |
| `onOrderUpdate(ctx, order)` | changement de statut d'un ordre |
| `onFunding(ctx, amount, rate)` | funding appliqué (futures) — `amount < 0` = payé |
| `onStop(ctx)` | arrêt propre — annulez vos ordres ici |

## `ctx.state` vs `ctx.locals`

- `locals` : handles d'indicateurs, caches — reconstruit à chaque démarrage.
- `state` : valeurs JSON (prix de stop, compteurs, flags) — **persisté en live**, restauré après crash/redémarrage du VPS. En backtest il vit en mémoire et finit dans le résultat.

## Backtest : ce qu'il faut savoir

- **Warmup** : l'historique nécessaire aux indicateurs est préchargé ; vos hooks ne sont PAS appelés pendant le warmup (les indicateurs se remplissent silencieusement).
- **Fills `candle`** (défaut) : chemin intra-bougie O→L→H→C (vert) / O→H→L→C (rouge), ou `pessimistic` (les stops d'abord). Ordres market remplis à l'open suivant ± slippage. Limits maker au toucher, gaps gérés.
- **Fills `aggtrades`** : chaque trade agrégé est rejoué — déclenchements exacts, fills partiels proportionnels au volume imprimé (`limitFillRatio`). Beaucoup plus lent, beaucoup plus fidèle. Les données se téléchargent automatiquement (ZIP Binance Vision).
- **Frais** : maker/taker configurables, réduction BNB (-25 % spot / -10 % futures). Sans BNB, les frais rognent l'actif reçu, comme sur Binance — votre position reflète ce que vous détenez réellement.
- **Futures** : funding historique appliqué toutes les 8 h, liquidation approximée (marge isolée), levier, shorts.
- Un trade clôturé porte : PnL net, frais, funding, **MAE/MFE** (pire/meilleure excursion), raisons d'entrée/sortie.

## Anti-patterns

- ❌ Lire `candle.close` du feed HTF **avant** sa clôture — impossible par construction (vous ne recevez que des bougies clôturées), mais attention : la bougie 4h « courante » côté `ctx.feed('htf')` est la *dernière clôturée*.
- ❌ Garder des données dans des variables de module (partagées entre instances de bots) → utilisez `locals`/`state`.
- ❌ Oublier `reason` sur les ordres → vous perdrez l'explicabilité des trades.
- ❌ `ctx.indicator()` hors de `init()` → exception (l'historique ne serait pas déterministe).

## Dénomination en actif de base (accumulation BTC)

Par défaut un backtest mesure la performance en **USDT** (`denomination: 'quote'`). Pour les stratégies dont le but est d'**accumuler l'actif de base** (avoir le plus de BTC possible, pas le plus d'USDT), utilisez `denomination: 'base'` (spot uniquement) :

- on **DÉTIENT** `initialBalance` unités de base au départ (ex : 1 BTC) ;
- l'équité et toutes les métriques sont mesurées **en BTC** ;
- le benchmark buy & hold = « garder son BTC » = **0 %** (chaque % au-dessus = du BTC gagné) ;
- un trade = une excursion **vendre → racheter** ; son P&L est le **BTC gagné** (racheter plus bas accumule, racheter plus haut perd du BTC).

Côté stratégie, c'est du spot normal : `ctx.position.qty > 0` = on détient du BTC (état neutre), `== 0` = on a vendu (en USDT). On vend (`SELL`) pour ouvrir l'excursion, on rachète (`BUY` avec `quoteQty` = tout l'USDT) pour la fermer. Voir `strategies/btc-accumulator.ts` (vend uniquement en vrai bear : EMA200 1d en déclin). Réglable dans le formulaire de backtest (sélecteur **Dénomination**, marchés spot).
