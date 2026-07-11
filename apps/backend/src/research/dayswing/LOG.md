# Campagne DAY-SWING — trading classique USD→BTC→USD (~1 trade/jour)

**Début : 2026-07-08. Statut : EN COURS — Phase 0.**

Journal vivant de la campagne. Convention héritée d'`accum2/LOG.md` : réfuter vite,
plateau > pic, holdout dépensé une fois, ledger de TOUT ce qui est testé.

---

## 1. Mission

Trouver un **edge validé** pour une stratégie **spot BTC/USDT, long-only, denominée USDT**
(on part du dollar, on achète, on revend — l'inverse structurel de l'accumulateur) :

- Fréquence : **~1 trade/jour en ordre de grandeur** (0,3–2/jour en période active, parfois 0).
  Pas du scalping : signaux 15m–4h, holding **4 h → 48 h**.
- **Win rate élevé** = objectif produit (confort psychologique utilisateur), mais l'expectancy
  nette prime — le WR s'ingénierie ensuite par les exits (TP < stop, time-stop) SI une dérive
  conditionnelle réelle existe après l'entrée.
- Exécution OKX spot, données Binance (candles + takerBuyBase). Long-only (spot, pas de marge).

**Le problème central est arithmétique : les frais.** Taker 0,10 % + slippage 0,05 % par côté
= **0,30 % le roundtrip**. À 1 trade/jour, ~110 %/an de friction sur le notionnel tourné.
La variante 1h de l'accumulateur perdait 16,7 % en frais (ledger accum2 T1). Donc :
- toute hypothèse doit dégager une dérive conditionnelle **> 0,45–0,60 % brut par trade** (marge ×1,5–2 sur les coûts) ;
- privilégier les entrées **maker** (0,08 %, zéro slippage sur limit au repos dans le sim) quand la mécanique le permet ;
- mesurer l'edge en **event study d'abord** (gratuit), en backtest ensuite.

## 2. Barre de succès (pré-enregistrée — on ne la déplace pas après coup)

Une stratégie est déployable en démo si TOUT tient :

| Critère | Seuil |
|---|---|
| Expectancy nette/trade (coûts pleins) | ≥ +0,25 % en IS **et** en WF-OOS composé |
| Profit factor net | ≥ 1,3 IS ; ≥ 1,15 WF-OOS composé |
| Walk-forward 6–8 fenêtres 2019→2026 | OOS composé > 0, ≥ 60 % fenêtres positives |
| Échantillon | ≥ 150 trades IS, ≥ 80 trades WF-OOS |
| Null timing-aveugle apparié (§4) | percentile ≥ 95 |
| Plateau de params | médiane du voisinage > baseline (jamais le meilleur point) |
| Stress coûts ×2 (0,30 %→0,60 % RT) | reste positif ; ×3 = survivable (PF > 0,9) |
| Win rate | ≥ 55 % visé (arbitrable si expectancy/DD meilleurs) |
| Max drawdown équité | ≤ 20 % à pleine taille |
| Bear 2018 + bear 2022 (long-only) | ~flat (le filtre de régime ne doit pas saigner) |
| Passe de sensibilité (§4) | résolution, miroir, transfert ETH, contrôle négatif |

## 3. Découpage temporel (pré-enregistré)

Spot BTCUSDT dispo 2017-08→now (effectif ~2018-04 avec warmup). Funding 2020-01→now.

- **IS (conception + tuning)** : 2019-01 → 2025-01 (tous les régimes : bull 19-21, bear 22, chop 23, ETF 24).
- **OOS (1 test par FAMILLE promue, jamais par variante)** : 2025-01 → 2026-01.
- **HOLDOUT (une seule dépense, stratégie finale figée)** : 2026-01 → 2026-07.
- **Stress structurel** : 2018-05 → 2019-01 (bear -59 %) — une fois par candidat final, long-only doit survivre ~flat.
- **Validation primaire = WF roulant** 2019-01 → 2026-01 (6–8 fenêtres, `walkForwardWindows`), l'OOS composé est LE chiffre.

⚠ **Rupture structurelle ETF (2024-01)** : les effets de session/saisonnalité peuvent n'exister
qu'après l'arrivée des ETF spot US (flux de créations/rachats quotidiens). Pour les familles
« saisonnalité » (H1/H6) : l'effet doit être visible **séparément** sur 2024 (dans l'IS) ET sur
2025 (OOS), et la stabilité année-par-année est obligatoire pour toutes les familles — un effet
porté par une seule année = réfuté.

## 4. Protocole statistique

- **Event studies avant backtests** : E[fwd | condition] vs baseline appariée au régime,
  horizons pré-enregistrés **{4 h, 8 h, 24 h, 48 h}**, grains **{15m, 1h, 4h}**.
  IC par **bootstrap par blocs** (les fenêtres forward se chevauchent — leçon aggflow : les
  hints sur petits n disparaissent ; **n ≥ 300 événements IS** minimum avant d'y croire).
- **Valeur marginale de chaque couche** (méthodo gate.ts) : chaque filtre ajouté doit séparer
  (Welch t sur fwd, |t| ≥ 2 et effet économique) au-delà des couches déjà posées. Sinon il dégage.
- **Null timing-aveugle apparié** (à recréer — pas de runner commité) : mêmes nombre de trades,
  mêmes durées de holding, entrées tirées au hasard **dans le même sous-ensemble de barres
  autorisées par le filtre de régime** → distribution des nets → percentile de la vraie stratégie.
  Généralisation du null V5 d'accum2 (médiane random -22 % vs v2 +120 % = p97,3).
- **Passe de sensibilité obligatoire** (leçon wedges G4) : résolution des params (L, fenêtres),
  **miroir** (le signal short symétrique en contrôle négatif d'une thèse long), **transfert ETH**
  (effet partiel attendu, signe cohérent), décalage de phase des bougies quand pertinent.
- **Ledger de multiple testing** : §8, IDs `D*`. On compte TOUT, y compris les réglages avortés.
- **DST géré** : les effets ancrés sur les heures US se mesurent en heure de New York
  (règle DST US 2007+, testée unitairement), pas seulement en heure UTC, sinon l'effet se
  dilue sur deux bins.

## 5. Modèle de coûts (fixé)

- Défaut : **taker 0,10 % + slip 0,05 %** par côté (convention repo, `DEFAULT_FEES.spot`).
- Variante maker : **0,08 %, slip 0** (limit au repos ; fill uniquement si le prix traverse,
  `limitFillRatio` conservé au défaut 0,25 pour le partiel intrabar).
- Stress : ×2 / ×3 (robust.ts pattern). `intrabarPath: 'pessimistic'` en contre-vérification
  des stratégies à stops serrés.

## 6. Carte des interdits — familles DÉJÀ réfutées (ne pas retester sans angle NOUVEAU)

Héritées de ~40 familles réfutées (accum2/LOG.md, aggflow/LOG.md, campagne er-flow 2026-06) :

- **Mean reversion par oscillateurs/bandes** : RSI2/3, Bollinger, maker-limit — mort 15m–4h,
  taker ET maker, TOUS gatings (PF ~0,95 même à coût nul = structurel). Dans les DEUX sens
  (le fade des rips en bear perd aussi : les rips continuent).
- **S/R niveaux** : pivots fractals (cassés 73 % en bear), ronds psychologiques, volume
  profile/POC — les niveaux se traversent, pas de rejet exploitable.
- **Chartisme** : 34 patterns de chandeliers (les baissiers précèdent des hausses), H&S,
  double top, wedges (artefact de résolution), Fib, order-blocks standalone.
- **aggTrades stratifié baleine/retail** : zéro valeur au-delà du takerFlow candle (corr
  partielle ±0,01). Ne pas télécharger des Go de ticks sans signal candle-level préalable.
- **Basis perp-spot / canal sentiment** : t=-2,7 BTC tué par non-réplication ETH (t=+0,01).
- **Sessions comme filtre de VENTE accumulateur** (F5, |t|≤1,34) — ≠ dérive long conditionnelle,
  qu'on va cartographier proprement, mais prudence : le prior sur H1 n'est pas vierge.

**Faits structurels établis** (sur lesquels ON S'APPUIE) :
1. **BTC = actif de continuation** à tous les grains testés : la force continue, la faiblesse
   continue, les niveaux cassent, les fades perdent.
2. Le seul edge validé du repo = **mécanique d'excursion** (stop cappé + exit rapide +
   ré-entrée immédiate → asymétrie de payoff), percentile 97,3 vs null. Rien à l'ENTRÉE ne
   prédit l'issue d'un trade individuel (issues ~i.i.d.) — c'est l'EXIT qui fait l'edge.
3. Les conjonctions battent les signaux isolés (régime × ER × flux × prix).
4. takerFlow : seuil binaire à 0,5 (le ratio lissé colle à 0,5 ; 0,52 tue tout).

## 7. Backlog d'hypothèses (priorisé — priors explicites)

- **H1 — Dérive de session US conditionnée** (prior : moyen+, surtout post-2024).
  Thèse : les rendements BTC se concentrent dans les heures US (flux ETF/TradFi), la nuit
  US/weekend ≈ 0. Si vrai conditionnellement (régime haussier × direction overnight × flux),
  un « US-session rider » fait ~1 trade/jour par construction. Mesure en heure de New York.
  Kill : dérive conditionnelle < 0,45 %/jour actif, ou instable année-par-année, ou absente en 2025.
- **H2 — Sweep & reclaim de swing low** (prior : moyen).
  Thèse : en régime haussier, le balayage d'un plus-bas structurel (stop hunt sous swing low)
  suivi d'un reclaim rapide = continuation du mouvement de fond (échec de cassure = signal de
  force — cohérent avec « les cassures réussissent » : ici on trade la cassure RATÉE comme
  confirmation de l'autre sens). Angle nouveau vs MR morte : événement structurel discret +
  invalidation naturelle (stop sous le sweep) — pas un oscillateur. Nécessite le moteur de
  pivots no-lookahead (P0.b). Kill : fwd(reclaim) ≈ fwd(baseline régime) ou n < 300.
- **H3 — Continuation d'impulsion confirmée flux** (prior : moyen+).
  Thèse : après impulsion 1h/4h ≥ k×ATR avec efficiency élevée ET takerFlow > 0,5, la suite
  monte encore (le fait n°1 dit que fader perd — tester le côté long directement).
  Kill : continuation < coûts après conditionnement, ou déjà capturée par er-flow 4h (redondance).
- **H4 — Compression → expansion** (prior : moyen ; keltner-squeeze PF 2,07 à 4h mais trop rare).
  Thèse : squeezeRatio/NR-k au 1h-4h + breakout directionnel confirmé flux = départ de mouvement.
  Densifier au 1h ce qui était trop rare au 4h. Kill : densification = dilution (PF → 1).
- **H5 — Excursion USD en régime haussier** (prior : moyen — miroir du seul edge validé).
  Thèse : transposer la MÉCANIQUE d'excursion complète côté long : en bull confirmé multi-TF,
  acheter la faiblesse courte (recross EMA up), stop cappé serré, exit rapide sur force, ré-entrée
  immédiate. ⚠ proximité avec la MR morte : la différence revendiquée = mécanique d'exit
  asymétrique + ré-entrée (pas le signal d'entrée). À tester en dernier des event studies,
  directement en mini-backtest avec le null apparié. Kill : percentile < 95 vs null.
- **H6 — Méta-couche calendrier** (jamais standalone) : n'autoriser les entrées que dans les
  fenêtres heure×jour où la dérive conditionnelle existe (sortie de P0), ex. exclure le weekend
  post-2024 (vol effondrée). S'applique par-dessus H1–H5, valeur marginale mesurée façon gate.ts.

Enrichissement en attente : rapport deep-research web (workflow en cours) — croiser et ajouter
les edges documentés 2023-2026 avec tailles d'effet, en filtrant par la carte des interdits.

## 8. Phases

- **P0 — Terrain** : `data.ts` (backfill 15m spot BTC+ETH, 1h ETH) puis `phase0.ts` :
  décomposition heure-UTC/heure-NY/jour × année × régime ; courbes de continuation
  E[fwd h | mouvement passé, flux] ; structure de vol (ATR%ile par heure, weekend) ; autour des
  timestamps funding. Overlay coûts sur chaque cellule. → tue/priorise H1/H3/H6 avant toute ligne de stratégie.
- **P0.b — Moteur de pivots/swings** no-lookahead (`packages/core` + tests) : fractals L/L avec
  lag de confirmation explicite + zigzag ATR ; test d'invariance par troncature (prouve zéro
  lookahead) + rendu visuel de vérification. Prérequis H2.
- **P1 — Event studies** H1–H4 (+ deep research), gate marginal par couche.
- **P2 — Prototypes** `defineStrategy` des survivants, exits ingénieriés sur la forme des courbes
  de dérive (TP/stop/time-stop → WR), maker si possible, coûts pleins.
- **P3 — Validation** : WF 6–8 fenêtres, null apparié percentile, sensibilité, stress coûts.
- **P4 — Holdout** unique + verdict GO/NO-GO + doc.

## 9. Ledger des essais (multiple testing — TOUT compter)

| ID | Date | Hypothèse/variante | Méthode | Verdict | Notes |
|---|---|---|---|---|---|
| D1 | 07-08 | Saisonnalité horaire | phase0 §1, 1h IS 2019-25, 24 cell.×2 tz | ◐ overlay seulement | Meilleure cellule : **17h NY +7,4 bps/h [t=5,0]**, sig. dans les 3 ères (+12,1/+4,1/+7,8) ; ancre NY > UTC (t 5,0 vs 3,1 : l'effet suit l'horloge US, DST-aware obligatoire). 21-22 UTC +4,9/+3,7 [3,1/2,6] mais 2022-23 ≈ 0 année par année. ~10 bps/2h < 16 bps RT maker : PAS un edge autonome — réplique le finding Quantpedia du deep research. |
| D2 | 07-08 | Jour de semaine | phase0 §2 | ✗ réfuté | Rien de stable : lun +43 [1,9] mais -2,9 en 2021-23 ; mer +46 [2,2] sans structure par ère. n≈313/jour insuffisant pour un petit effet. |
| D3 | 07-08 | Cycle funding 8h | phase0 §3 | ✗ (faible) | Offset 5 (h 5/13/21 UTC) +2,9 [3,4**] mais porté par 2019-20 (+4,5) et confondu avec D1 (21 UTC ∈ offset 5). Pas exploitable seul ; ne pas retester sans conditionnement OI/funding réel. |
| D4 | 07-08 | Weekend / structure d'activité | phase0 §4 | ✓ fait structurel | Vol weekend/semaine **0,87→0,58 monotone 2019→2024** (réplique Kaiko). Heures calmes 3-5 UTC, actives 14-16 UTC. → filtre d'activité gratuit : éviter les entrées weekend post-2022. |
| D5 | 07-08 | Continuation 4h/24h × régime | phase0 §5, quintiles + bootstrap blocs | **✓✓ pilier confirmé** | U-shape brut ; en **BULL** monotone : Q5-24h → +13,4/8h [5,2], +34,0/24h [7,6], +56,0/48h [9,5], CI bootstrap > 0. En **BEAR** Q5 **s'inverse** : -16,3/24h [-2,7] (les rallyes de bear échouent) → gate de régime OBLIGATOIRE en long-only. Q1 (gros dips) : drift long terme + mais nul à 4-8h en bull → pas de dip-buying court terme (H5 prior ↓). |
| D6 | 07-08 | Conjonction impulsion×flow×bull (H3) | phase0 §5b | **✓ candidat n°1 → Phase 1** | p90-impulsion 4h seule : +7,8/8h [2,3]. × flow10>0,5 : **+13,3/8h [3,2]** vs divergence flow<0,5 : **+0,4/8h** — le flux SÉPARE (valeur marginale réelle). × bull : +28,7/24h [3,3], +47,4/48h [4,0]. n=1953 barres-événements (~0,9/jour AVANT dé-chevauchement). ~28 bps/24h vs 23-30 de coûts : marginal brut → Phase 1 = resserrage (p95, flow fort, timing NY) + ingénierie d'exit. |
| D7 | 07-08 | H1 « dérive heures cash US (ETF) » | phase0 §6 | ✗ version naïve réfutée | 2024 cash US : **-2,3 bps/j** (!) ; la dérive 2024 vit le SOIR (after 16-21 NY +7,0) et la NUIT (21-9 NY +16,8). IS-all : after-hours +7,1/j [2,1*], + 5 années/6. H1 → reformulée « dérive du soir/nuit », faible seule, à croiser avec D1/D6. |
| D8 | 07-08 | **H2 sweep&reclaim de swing low** | h2sweep.ts, event study 1h, L∈{3,5,8}×k∈{2,4}, miroir, strates profondeur/flux/vitesse | **✗ réfutée** | En bull : fwd ≈ baseline régime partout (meilleure cellule 5/5,k4 24h +35,1 vs +18,4, tW=1,5 — pas sig., pas stable en résolution). En bear : le reclaim CONTINUE de baisser à 8h (-12..-17 vs +2,7). Strates : rien ne sépare (|t|<1,6 ; flux dans le mauvais sens = bruit). Miroir : biais 4h légèrement négatif des DEUX côtés → le sweep n'a pas de direction. Cohérent avec « les niveaux cassent » (sr-research). Seul angle non testé : grain 15m — prior désormais faible, ne pas dépenser sans angle neuf. |
| D9 | 07-08 | **H3 impulsion×flux×bull (event study)** | h3impulse.ts, events dé-chevauchés, p85/90/95 × 8/24/48h, chemin, heure NY, mini-null, ETH | ◐ dérive réelle mais mince | Plateau p85-p90 (p95 PIRE — non monotone) : +37/24h [2,6], +60-65/48h [2,4-2,5], positif dans les 3 ères, **transfert ETH ✓** (+19/8h [2,1], +69/48h). MAIS : mini-null apparié → **percentile 82,5 < 95** (l'essentiel = être long en bull) ; chemin : 8 premières h = chop (médiane nég.), payoff à 12-48h ; MAE ±250-360 vs dérive +30-65 = ratio bruit/edge ~8:1. WR 50-54 % seulement. Fréquence 64-95 ev/an (~1/4-6 jours, SOUS la cible 1/j). Heure NY de l'event : nuit +68 [2,4] vs after-hours **-62** [-1,9] — sous-groupe ×3, prior sceptique, à revoir seulement en plateau Phase 2/3. |
| D10 | 07-08 | **H3 exits premier passage** (TP×stop×time, séquentiel, entrée open+1 taker, TP maker) | h3exits.ts, grille 5×4×2, p85 | **✗✗ le day-trading 1h meurt ici** | TOUTES les cellules TP finies < 0 : médianes -17 à -21 bps/trade, t jusqu'à **-17,7**. Le WR élevé ne sauve RIEN (TP40/stop300 : 84 % WR, -16,5/trade). Seul TP=∞/stop large/48h ≈ 0 (+6,4 [0,4]). Cause structurelle : bruit/edge 8:1 → tout exit intraday sélectionne contre soi ; réplique indépendamment la conclusion deep-research (≈31 trades/an survivent aux coûts) et accum2-T1 (grain 1h = frais). **Interdit de retester des exits serrés sur signaux 1h sans edge brut ≥ 3× coûts.** |
| D11 | 07-08 | **H4 compression→expansion 1h** (range 24h, stop structurel = bas du range, TP k×range) | h4squeeze.ts | ✗ pas monétisable | Dérive brute réelle et PHYSIQUE : monotone en compression (q10 +87/48h > q20 +75 [2,6] > q30 +55), flow/bull n'ajoutent RIEN (l'info est dans la cassure). MAIS stop « structurel » 24h = ~250 bps médians (pas serré), premier passage : aucune cellule significative (max +38 [1,1] à 15 tr/an), q30 négatif. Miroir : cassure basse en bear ne continue PAS (fwd +9..+19) — expansion asymétrique haussière. Même maladie que H3 : l'edge vit à 48h+, pas en intraday. |
| D12 | 07-08 | **H4b compression 15m** (fenêtres 8h/24h, stops serrés 95-210 bps, TP 1-2R) | h4b15m.ts | **✗✗ l'intraday est CLOS** | Au 15m les cassures **mean-revertent d'abord** (fwd 2-4h : -5 à -6,6 bps, t=-2,0), payoff seulement à 24h (+23 [2,5]). Premier passage : **les 24 cellules négatives** (-12 à -29 bps/trade, t jusqu'à -5,7), WR 34-51 % quand il faudrait 55 %+ à 1R. À 84-152 signaux/an (la fréquence cible !) → -1000 à -2000 bps/an. **Triple réplication (D10, D11, D12) : aucune fréquence intraday ne survit aux coûts spot. Interdiction de retester de l'intraday BTC spot sans changement structurel des coûts (VIP/rebates) ou un edge brut ≥ 3× coûts démontré d'abord en event study.** |
| D13 | 07-08 | **H5' duel des porteurs 48-72h** (A imp, B squeeze, C∪, D∩ ; taker vs maker δ10/30 ; stop -300, time 48/72h) | h5swing.ts | ◐ mince, sous la barre | Meilleur porteur = **B squeeze-brk** : +42/48h [1,6], +58/72h [1,7], 33-38 tr/an, positif 5 années/6 (2022 : -8,8 bénin) ; A instable (2019 nég.). WR 39-47 % partout (pas un produit high-WR). **Trouvaille exécution réutilisable : l'entrée MAKER δ=30 bps AMÉLIORE net** (A : +6→+33 [1,7] ; fill 83 %) MALGRÉ un biais de sélection adverse mesuré (fwd fantôme des non-remplis : +249-277 bps) — l'économie de coûts + meilleur prix l'emportent. Rien ne franchit t=2 → en l'état, la famille 48-72h NE passe PAS la barre pré-enregistrée en event study ; sa forme converge vers er-flow-trend (4h, exit recross, bull-gated, WF-validée 2026-06 puis archivée). |
| D22 | 07-11 | **Vague 3 : le côté SHORT (frontière futures) + composite DCA→accumulateur** (donchshort.ts avec funding réel ; contribsim.ts étendu, index BTC du moteur accumulateur) | event study + premier passage short bear-gaté ; contributions 500 €/mois, 4 départs, jusqu'à aujourd'hui | **short : ✗ trop faible · DCA→accum : ✓✓ bat le DCA partout** | **Short D55-bas × vol × bear** : direction OK (fwd42b -106 vs bear +18) mais n=48/7 ans, tW=-0,6, fwd126b s'INVERSE (+46 — les rallyes de bear reprennent tout, cohérent avec l'anatomie accum) ; premier passage futures (frais 10 bps RT, funding réel ≈ 0 net) : +96..134 bps/trade [t 0,7-0,8], ~7 tr/an → PAS validable, ne transformera pas la courbe. **La façon validée de « shorter » les bears = l'accumulateur** (excursions p97). **Composite DCA→accumulateur (500 €/mois)** : 2019 : **247 139 € (×5,43) vs DCA 155 932 € (×3,43)** — +91 k€/+58 %, DD -53 vs -74 ; 2021 : 65,6 k vs 51,2 k ; 2022 : 47,8 k vs 42,2 k ; 2024 : -9 % vs -15 % (pas de bear soutenu à récolter). **Bat le DCA pur sur 4 départs/4 en euros finaux ET en DD** — même mandat (finit en BTC), même effort, stratégie de prod déjà validée. BTC Swing reste le produit du mandat dollar (DD -12..-21 %, à son plus-haut aujourd'hui). Page btc-swing-vs-dca.html : 4ᵉ courbe ajoutée. |
| D21 | 07-11 | **VALIDATION ENGINE entryMode=donchian → BASCULE DU DÉFAUT** (btc-swing entryMode/donchLen/volMult ; wfswing --entry ; sensitdonch.ts) | engine réel, WF figé + null + stress + ETH + plateau 3×3 | **✓✓✓ GO — toutes les barres franchies (unique dans la campagne)** | Parité ema exacte (+294,4 % = D16 ✓, ajout non-cassant). **Donchian engine : WF +390,0 % (5/6, 2025 : +2,2 %) ; null apparié percentile 95,0 = barre atteinte** (toute la famille plafonnait à 88-91) ; plateau 9/9 (médiane +474 % > réf +433, PF 1,75-2,19 — pic à donchLen40 +904 % NON retenu, défaut = intérieur 55/1,5) ; coûts ×2 +346 %/×3 +247 % ; ETH +277,7 % PF 1,62 (> ema) ; full +474,3 % PF 1,85, 86 tr, DD -40,6 % (eq60 → -28,6 %/+222,6 %/PF 1,99) ; holdout : 0 barre bull 2026-H1 → 0 trade tout mode (pas de 2ᵉ dépense). Réserves restantes : DD > barre 20 % même à eq60 (dial de sizing à décider), WR 33 %, ~12 tr/an, multiple testing vague 2 (~120 cellules) compensé par : hurdles indépendants passés (engine/null/ETH/coûts), réplication juin-2026 (donchian futures PF 1,7-1,9), fondement Easley/O'Hara. **Défaut basculé entryMode='donchian'** ('ema' = comportement D15-D16 conservé en param). TODO : rafraîchir docs/btc-swing.html, bot démo. |
| D20 | 07-11 | **Deep-dive Donchian : plateau + premier passage + WF + isolation entrée/exit** (donch.ts, donchwf.ts, exitiso.ts) | grille 3×4, sim séquentielle coûts réels, WF 6 fenêtres (mêmes bornes que D16), null apparié, ETH | **✓✓ meilleur candidat de la campagne — validation engine à faire** | **Plateau : 12/12 cellules > baseline** (BTC 4h min +196/méd +283/max +334 vs +101 ; 1d et ETH idem) — structurel, pas un pic. Premier passage D55×vol1,5 : **+307 bps/trade net [t=2,1]** (time 126b), +280 [2,1] turtle, ~10-11 tr/an. **Overlap : 73 % des events couverts par un signal swing ±6 barres** → même famille d'edge (continuation bull), déclencheur différent. WF FIGÉ D55×vol×time126 : BTC **+484 % OOS (4/6)**, ETH **+551 % (5/6, 2025 : +33,9 %)** vs swing +294 %. Null apparié : **p88 BTC / p90,5 ETH — sous la barre 95** (comme swing p91 : toute la famille plafonne là contre le null à durées héritées). **Isolation entrée×exit (exitiso.ts) : l'ENTRÉE Donchian porte le gain** — donch×recross BTC : **+461,6 %, 6/6 fenêtres +** (bear22 : +0,5 vs -2,9 en time126) vs swing×recross +211,8 (5/6) même harnais ; ETH préfère time126 (+550,7). Multiple testing cumulé vague 2 : ~120 cellules + 6 combos — à décompter au verdict final. RESTE pour GO : stratégie engine (fills/frais réels), null de la config finale, sensibilité, et arbitrage produit (remplacer/compléter btc-swing). |
| D19 | 07-11 | **VAGUE 2 — balayage large recap-trading.html** (wide1.ts oscillateurs/indicateurs + wide2.ts structures, 1h/4h/1d × BTC/ETH, IS élargi 2018→2025-01, gate bull, dé-chevauché, contrôle négatif RSI2 ✓ sorti ≈0) | ~24 familles × TF × symboles (>100 cellules — multiple testing lourd, à décompter au verdict) | **1 seule famille surnage : Donchian breakout** | RÉFUTÉS/NULS : MACD (croix/zéro/histo — t<1,5 partout, ETH nul), Stoch<20 en bull (0 event !), RSI 30/50, pullback EMA50 (négatif t=-2,2), Supertrend flip (nég.), ADX-join (instable), divergences RSI/MACD (n<40, hints 4h non stables), flags 4h (+212 [0,9], measured-move WR 41 %×R:R 2,05 ≈ +0,25R brut, n=56 — marginal), pennants/fib-combo/vague-2/iH&S : trop rares ou négatifs (iH&S nég. — cimetière chartiste confirmé). **SURVIVANT : Donchian 20/55 long en bull** — BTC 4h : D55 +205/42b [1,1], **×volume>1,5×SMA20 : +291/42b [t=2,1], 4 ères positives (+241|+334|+218|+309)** ; BTC 1d : D20 +283/7b, D55 +683/21b [1,7], 4 ères + ; ETH : D55 +265/42b [1,3] (+162/12b [2,0]), ×vol +308 [1,6] ; converge avec Donchian-futures 2026-06 (PF 1,7-1,9), la physique H4 et Easley/O'Hara. → deep-dive : plateau longueur×vol×TF, premier passage, overlap vs btc-swing, null, WF. |
| D18 | 07-09 | **« 5 étoiles » order blocks (vidéo YouTube utilisateur)** — la seule brique jamais testée : FVG/imbalance comme filtre de zone | fvgob.ts, event study 1h+4h, zones bull-only, retours en zone vs baseline bull | **✗ réfuté — l'étoile phare s'inverse** | 1h, n=1898 : retour en zone OB = signal NÉGATIF vs bull (-6,5/48h vs +36,2, tW=-4,3 — les zones se traversent, cohérent sr-research). **★1 FVG : PIRE que sans FVG** (-24,9/48h [t=-3,5] vs +5,6) — la thèse centrale de la vidéo est inversée sur BTC. ★5 mitigation : aucun effet (1ʳᵉ visite ≈ revisites). ★3 discount : pas de séparation utile (le premium dérive PLUS à 24-48h en 4h — momentum, encore). Conjonction 5★ complète (n=111) : +24,5/24h = **exactement la baseline bull (t≈0)** — tout l'empilement ne fait que re-sélectionner des barres bull moyennes ; l'étoile qui porte TOUT = la n°2 (tendance) = notre gate de régime déjà en prod. Variante « reject-confirmation » : +33,9/8h [1,4], n=78, instable par ère — bruit. 4h : idem en plus bruité (5★ n=25, par ère -601/+39/-96). Le « 70-80 % WR à 2R » de la vidéo = PF 4,7-8 = marketing. Complète la lignée OB du repo : standalone OOS PF 0,60 (2026-06), zones de vente G6 -34/-42 %, sweeps D8, liquidité/S-R (73 % cassés), narratif « baleine protège son niveau » contredit par aggflow (flux baleine = zéro info marginale). Famille SMC/ICT close sur BTC ; seul réutilisable = ce qu'on exploite déjà (tendance + invalidation structurelle). |
| D17 | 07-09 | **Benchmarks B&H / régime-EMA200-1d** (benchmarks.ts, mêmes périodes/coûts, demande utilisateur pour le doc) | équité 1d, bascules à l'open J+1, 15 bps/côté | ✓ contexte produit consigné | 2019→2026-01 : **B&H +2261 % (DD -77)** > régime +1105 % (DD -56, 80 bascules, expo 65 %) > **Swing +433 % (DD -31, expo ~20 %)** — en brut ET en net/DD, le B&H gagne sur cette fenêtre bull-dominée. MAIS par fenêtre WF : Swing bat les DEUX benchmarks dans TOUTES les fenêtres non-bull (05/21→04/22 : +9,6 vs -25,5/-49,8 — le régime 1d seul fait PIRE que B&H dans les whipsaws ; 04/22→03/23 : +26,7 vs -42,7/+10 ; 2025 : -1,5 vs -16,6/-18,7) et perd toutes les fenêtres de bull franc. Positionnement honnête : produit de mandat USD + immunité aux -56/-77 % + capital en cash 80 % du temps ; PAS un batteur de B&H en bull. Section ajoutée au doc HTML. **Ajout 07-11 (demande utilisateur) : DCA hebdomadaire même budget** — full : +382,7 %/DD -65 %/expo 65 % ; bear18 -39,8 % ; 2022 -34,5 % ; holdout -21,4 %. **La v2 donchian domine le DCA sur les DEUX axes** (+474 vs +383, DD -41 vs -65) — le DCA achète mécaniquement toutes les chutes ; ses vertus restent zéro-suivi/zéro-infra, et son mandat (finir en BTC) le met en concurrence avec l'accumulateur, pas avec Swing. |
| D16 | 07-08 | **Phases 3+4 : validation finale BTC Swing** (wfswing.ts, holdout.ts — défauts FIGÉS) | WF 6 fen. + null 200 tirages + stress + ETH + bear2018 + HOLDOUT | **✓ GO DÉMO (conditionnel)** | **WF figé : +294,4 % OOS composé, 5/6 fenêtres +** (seule 2025 : -1,5 %) ; re-opt +397 % avec params intérieurs au plateau (er0,3-0,4/ema40-60/atr2-2,5) → figé défendable, refit optionnel. **Null apparié : percentile 91 < barre 95** ◐ — MAIS le null hérite des DURÉES réalisées (donc de l'intelligence d'exit) → sous-estime le skill ; à consigner, pas à excuser. Stress : coûts ×2 +293 % ✓, ×3 +190 % ✓, pessimistic = base (pas de TP, ambiguïté intrabar rare), equityPct 60 → **DD 20,7 % = barre atteignable par sizing** (98 % → DD 31 %). ETH : +186 %, PF 1,27, même signe ✓. **Bear 2018 : -8,1 % vs B&H -58,6 %** ✓. **HOLDOUT 2026-01→07 (dépense unique) : 0 trade, 0,0 % vs B&H -33,3 %** — gate de régime parfait sur données vierges ; ne valide pas l'expectancy (aucun trade), valide le modèle de risque. Barres renégociées par le pivot A : WR 34 % (produit trend, payoff ~3,4), échantillon 104 tr < 150. Baselines accumulateurs re-vérifiées intactes après backfill 15m ✓. **Produit : dormant en bear par construction — ne trade que régime 1d haussier.** |
| D15 | 07-08 | **Phase 2 : BTC Swing engine + ablation 2×2 des greffes** (strategies/btc-swing.ts, runswing.ts, coûts réels) | engine IS 2019→2025 + par année | **✓ cœur solide, greffes RÉFUTÉES in-engine** | er-flow nu sur spot : **+444 %, PF 1,78, WR 34 %, 89 tr (15/an), DD -31 %**, régime-gate parfait en 2022 (1 trade). Ablation par année : nu > greffé 4/6 années, et nu reste POSITIF en 2021 (+4,3 vs -14,1) et 2024 (+6,9 vs -5,1). **Falsification du transfert de D13 : l'avantage maker à horizon fixe 48h s'inverse à holding ~130 h avec exit recross** (économie de frais fixe ~25 bps vs coût croissant des runners ratés, fantômes D13 +250 bps) ; anti-weekend rate des entrées porteuses ; fenêtre NY : -92 pts (artefact confirmé). → défauts produit : maker OFF, weekend OFF, NY OFF (params conservés pour la sensibilité). ⚠ DD 31 % > barre 20 % à equityPct 98 — à traiter en sizing post-validation. ⚠ WR 34 % : produit trend-following (payoff ~3,4), pas high-WR — renégocié avec le pivot Option A. TODO : métrique exposurePct suspecte (96 % affiché vs ~20 % réel calculé) — à auditer, non bloquant. |
| D14 | 07-08 | **Intégration deep research web** (workflow 103 agents, 21 claims confirmés 3-0 / 4 réfutés, sources primaires BIS/JFM/CMU/Easley-O'Hara vérifiées au PDF) | rapport final (tasks/wwp3nq001.output) | ✓ scelle l'intraday, 0 sauvetage | **Microstructure BTC-seul : tout est mort ou hors-portée** — cycle funding 2,5 bps pic-creux vs ~20 de coûts (= notre D3) ; basis perp-spot Binance : quelques bps d'amplitude (médiane -0,015 %, répliquée indépendamment sur data.binance.vision) ; carry comprimé post-ETF -36 %/-97 % (BIS DiD) et niveaux 2020-21 invalides (cap levier 07-2021 : 39 %→7,6 %/an) ; « funding connu d'avance » réfuté 0-3 ; flux taker BTC-seul J+1 ≈ 0 en brut (réversion transitoire), la version long-only rentable RÉFUTÉE 1-2. **Appuis positifs** : Easley/O'Hara (JFM 2026) = fondement microstructurel de NOTRE fait n°1 (imbalance→autocorr positive→momentum) ; saisonnalité 22-23 UTC confirmée mais ~7 bps/trade, heures choisies in-sample, non robuste inter-exchanges (Baur 2019), « rough 2022-23 » (= notre drill-down D1). **Parqués (futures campagnes, pas celle-ci)** : rotation cross-sectionnelle flux orthogonalisé 82 coins (30-79 bps/j BRUTS, break-even 0,48 %/j vs coûts 0,3-0,5 — marge nette mince + infra multi-coins) ; VPIN/Roll klines 1m comme filtre de RÉGIME DE VOL (accuracy 0,56-0,58, pas directionnel). Les « openQuestions » du rapport (MR/sweeps, persistance post-ETF des heures) : déjà tranchées localement (D8, D1). |

## 10. Décisions & état

- 2026-07-08 : campagne ouverte. Données : spot 1h/4h/1d/3d/1w complets 2017→2026 ✓ ;
  15m spot = 20 jours seulement → backfill lancé ; funding 2020→2026 ✓ ; aggTrades : aucun
  sur disque (et on n'en veut pas en masse — disque 12 Go).
- 2026-07-08 : backfill fait (15m BTC+ETH, 1h ETH spot, 2017-08→now) ; `time.ts` NY/DST
  testé 8/8 ; `phase0.ts` exécuté sur IS (sortie : scratchpad/phase0-is.txt). Sanité données :
  trous 1h ≤ 0,38 %/an, flow dégénéré 0 %. **Verdicts D1-D7 au ledger.** Priorisation issue
  de la Phase 0 : **H3 (impulsion×flux×bull) = candidat n°1** ; D1 17h-NY et D4 anti-weekend
  = couches d'appoint ; H1 naïve réfutée (D7) ; H5 dégradée (dip-buy court terme nul en bull) ;
  H2 (sweep&reclaim) inchangée, attend le moteur de pivots (P0.b).
- 2026-07-08 — **VERDICT PHASE 1 (D1-D13, 13 familles/variantes au ledger)** :
  **(1) L'intraday BTC spot est CLOS aux coûts OKX retail** — triple réplication indépendante
  (D10 exits 1h : t=-17,7 ; D11 squeeze 1h ; D12 15m : 24/24 cellules négatives). Mécanisme
  identifié : bruit/edge ~8:1 à ces horizons + 23-30 bps de friction → tout exit intraday
  sélectionne contre soi ; le WR élevé par TP serré est expectancy-NÉGATIF (D10). Concorde
  avec le deep research (≈31 trades/an survivent) et accum2-T1.
  **(2) La dérive exploitable vit à 48-72h+** : continuation bull-gatée réelle (D5-D6, t 5-9,5
  en event study brut, ETH ✓) mais une fois exécutée : +33-58 bps/trade, t≈1,6-1,7, WR 39-47 %,
  33-80 tr/an (D13) = SOUS la barre pré-enregistrée (§2). Sa forme = er-flow-trend redécouverte.
  **(3) By-products positifs réutilisables** : entrée maker δ30 (+27 bps/trade net vs taker,
  biais de fill mesuré et payé — D13) ; overlay 17h-NY (+7,4 bps/h [5,0], D1) ; anti-weekend
  (D4) ; moteur de pivots core testé (P0.b).
  **Suite proposée (décision utilisateur)** : pivoter la campagne sur le swing 2-3 j — adapter
  er-flow-trend en spot USDT (elle a déjà un WF 5/5 OOS +44,5 % en futures) + y greffer les
  by-products (maker, timing NY), puis Phases 2-4 du protocole ; OU acter le NO-GO du concept
  « 1 trade/jour WR élevé » (réponse scientifique honnête). En attente : verdicts wave-3 du
  deep research (funding/basis/carry — seule classe d'événements pas encore testée localement).
- 2026-07-08 : **P0.b fait — moteur de pivots/swings livré dans `packages/core`**
  (`indicators/pivots.ts` : `fractalPivots(L,R)` avec lag de confirmation R explicite dans le
  type, convention plateau = première barre ; `zigzag(L,R,minAtrMult,atrPeriod)` alternance
  stricte + remplacement causal du dernier point). Validation 3 axes : tests unitaires 8/8
  (dont **invariance par troncature sur 300 préfixes** = preuve no-lookahead, série piège,
  plateaux d'égalité) ; test terrain `dayswing/pivotcheck.ts` : 277 pivots réels BTC 4h,
  **0 incohérence** vs série brute ; structure zigzag récente lue et cohérente (capitulation
  10,2×ATR 05-06, LL 58,1k 25-06, HH 02-07). Suite core 74/74, typecheck monorepo vert.
  ⚠ contrat : état muté en place — ne lire que l'état courant, jamais `at(n)`.
