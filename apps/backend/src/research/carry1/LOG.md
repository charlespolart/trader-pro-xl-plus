# Campagne carry1 — carry de funding delta-neutre (2026-07-12)

**Mission** (GO Mario : « chantier futures ops, si moyen d'être rentable il faut
y aller ») : quantifier le rendement NET historique du cash-and-carry crypto —
long spot + short perpétuel de même notional, encaisser le funding — avant toute
décision d'engineering futures. Ce n'est PAS du mining de signal : comptabilité
d'un premium structurel. Pas d'OOS à protéger ; l'ennemi ici est le biais
d'hypothèses (frais/marge irréalistes), d'où le pré-enregistrement ci-dessous.

## Hypothèses comptables PRÉ-ENREGISTRÉES (écrites avant tout résultat)

- **Données** : funding EXACT par événement (8 h, 3×/j), API Binance
  `/fapi/v1/fundingRate`, BTCUSDT + ETHUSDT, profondeur maximale (2019-09→).
  Le short reçoit le funding quand le taux est positif. Cross-check des niveaux
  vs OKX (Coinalyze daily, venue d'exécution réelle) — écart attendu faible.
- **Coûts round-trip pré-enregistrés : 0,40 % du notional par cycle**
  (spot taker 0,10 % + perp taker 0,05 % à l'entrée, idem sortie = 0,30 %,
  + 0,10 % de slippage/basis d'exécution forfaitaire). Sensibilité affichée à
  0,20 % / 0,40 % / 0,60 % — grille de coûts uniquement, pas de grille de
  stratégie.
- **Deux modèles de capital, la vérité opérationnelle entre les deux** :
  - *prudent* : marge du short = 100 % du notional → rendement = funding × 0,50 ;
  - *efficace* : marge 20 % (5×, spot en collatéral cross/portfolio) →
    rendement = funding × 0,83. Risque de liquidation du pair quasi nul en
    portfolio margin (les jambes se compensent), non nul en comptes séparés.
- **Deux politiques, AUCUNE optimisation** :
  - (a) *hold permanent* : toujours investi, coût 0,40 % une fois ;
  - (b) *règle mécanique unique* : sortir si funding moyen 7 j < 0, rentrer
    si > 0 (décision sur l'info de la veille, causale), 0,40 % par cycle.
  Les deux sont rapportées telles quelles — pas de variante supplémentaire.
- **Métriques** : rendement net annualisé par année civile, courbe cumulée,
  pire année, pire mois, % de jours à funding négatif, nb de cycles pour (b),
  contexte basis perp-spot (distribution 1 h, candles futures vs spot en base).
- **Barre d'intérêt pré-enregistrée** : moyenne ≥ 6 %/an net (modèle efficace,
  coûts 0,40 %) ET pire année ≥ -1 % sur 2020→2026, en (a) ou (b) sans retouche.
  En-dessous : chantier fermé (le rendement ne paie pas l'infra ni le risque
  de venue).
- **Risques hors modèle, à lister au verdict** : venue (faillite/gel), dépeg du
  collatéral, funding structurellement plus bas à l'avenir (compression du
  premium), risque opérationnel de marge en comptes non-portfolio.

## Plan

- [x] 1. fetch_funding.py — événements exacts Binance → PG `perp_funding`.
      Fait : 7 119 événements/symbole (2020-01-01→2026-06-30), via l'ARCHIVE
      data.binance.vision (l'API live fapi est géobloquée en France — HTTP 451).
- [x] 2. carry_study.py — comptabilité selon les hypothèses ci-dessus.
- [ ] 3. Spécifier la plomberie futures OKX (démo d'abord ; AUCUN live sans feu
      vert explicite) — verdict GO ci-dessous.

## Résultats (2026-07-12, hypothèses du pré-enregistrement, aucune retouche)

Net efficace = funding × 0,83, coûts 0,4 %/cycle. Politique (a) hold :

| Année | BTC brut | BTC net eff. | ETH net eff. | BTC %j<0 |
|---|---|---|---|---|
| 2020 | +17,2 % | +14,3 % | +22,8 % | 13,9 % |
| 2021 | +30,6 % | +25,4 % | +31,2 % | 7,9 % |
| 2022 | +4,2 % | **+3,5 %** | **+0,7 %** | 19,7 % |
| 2023 | +7,9 % | +6,5 % | +6,9 % | 7,7 % |
| 2024 | +12,0 % | +9,9 % | +10,8 % | 6,6 % |
| 2025 | +5,1 % | +4,3 % | +4,1 % | 8,2 % |
| 2026 H1 | +0,6 % | +0,5 % | +0,2 % | 36,5 % |

- Moyennes 6,5 ans : **BTC +9,88 %/an net efficace (+5,95 % prudent), ETH
  +11,75 % (+7,08 %)**. Max drawdown de la courbe de rendement : BTC -1,24 %,
  ETH -1,48 %. La règle (b) 7 j fait MOINS BIEN que hold partout (61 cycles de
  coûts pour rien) → simplicité gagne.
- Sensibilité coûts (hold) : insensible (1 seul cycle). Basis 1 h : ±0,1 %
  typique, légèrement négative 2022/25/26 (cohérent funding bas).
- Cross-check OKX (Coinalyze, approx) : mêmes niveaux, systématiquement
  ~15-20 % relatifs SOUS Binance (2024 : +10,4 vs +12,0 brut) — la venue
  d'exécution rendra un peu moins que ce backtest Binance.

**VERDICT vs barre pré-enregistrée (≥6 %/an net efficace moyen ET pire année
≥ -1 %) : PASSÉE sur les deux symboles en (a) hold.** GO pour spécifier la
plomberie.

⚠ Caveats honnêtes consignés :
- **Compression du premium** : la moyenne est tirée par 2020-21 ; les 4
  dernières années donnent ~+4 à +10 %, et 2026 H1 est quasi nulle (+0,5 %
  annualisé ~+1 %, 36,5 % de jours négatifs). Attente réaliste aujourd'hui :
  **~3-7 %/an net efficace**, cyclique avec l'appétit au levier (remonte en
  bull).
- Rendement en USDT sur le notional — pour l'objectif accumulation, décider en
  phase produit si le yield achète du BTC (DCA du carry) ou reste en quote.
- Risques hors modèle : venue (gel/faillite), dépeg du collatéral, marge en
  comptes non-portfolio (liquidation de jambe), exécution des bascules.

## Journal

- 2026-07-12 : campagne ouverte, hypothèses figées avant tout chiffre.
- 2026-07-12 (suite) : fetch + étude exécutés. Barre passée en hold → GO
  plomberie (démo). Découverte au passage : fapi.binance.com géobloqué (451)
  depuis la France — toujours passer par data.binance.vision pour l'historique.
