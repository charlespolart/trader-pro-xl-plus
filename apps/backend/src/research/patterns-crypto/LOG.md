# patterns-crypto — catalogue chartiste COMPLET, fidèle, multi-TF (protocole pré-enregistré)

**Ouvert le 2026-07-15, committé AVANT toute exécution.** Chantier OBLIGATOIRE
du mandat Mario (mission 2026-07-15) : vérifier/implémenter/placer
INTELLIGEMMENT toutes les figures chartistes et les indicateurs classiques,
sur fondations auditées (audit1 : moteur 0,0000 pt, indicateurs 41/41, données
canoniques saines).

## Ce que l'inventaire a établi (2026-07-15)

Déjà testé ICI et réfuté (constructions globalement propres) : S/R
pivots/ronds/volume-profile, order blocks + FVG ★5, 34 chandeliers, H&S,
doubles, wedges (⚠ artefact de résolution démasqué), Fibonacci (⚠ construction
glissante infidèle — audit1/A6), sweep&reclaim, squeeze, MACD/stoch/RSI/
supertrend/ADX/divergences. UN survivant : Donchian×volume → btc-swing.
Jamais fait ici : constructions FIDÈLES patterns2 (necklines inclinées,
tendance préalable, fib ancré), score de qualité + DOSE-RÉPONSE, multi-TF
1h/4h/1d, cup&handle, rounding, flags/pennants, triangles ≥3 touches, canaux.

## Hypothèses (falsifiables, priors déclarés)

- H-A (« mal placé ») : les figures FIDÈLEMENT construites et de HAUTE qualité
  chartiste ont un contenu prédictif que les constructions naïves ratent.
  Prior : FAIBLE (patterns2 actions : 0 survivant même fidèle ; mais 4h/1h
  crypto = terrain vierge, volume réel exploitable).
- H-B (dose-réponse) : si une famille a un contenu, ses instances haut-score
  battent les instances médiocres ET le tout-venant. PAS de dose-réponse = pas
  de contenu (tranche définitivement « mal placé vs sans valeur »).
- H-C (multi-TF) : les figures « vivent » sur 4h/1h en crypto (jamais testé
  côté actions, données gratuites ici).
- Prior global honnête : la littérature (Lo-Mamaysky-Wang, Bulkowski net de
  coûts) et patterns2 disent ≈ 0 sur daily indice. Un GO serait une SURPRISE ;
  la valeur du chantier est le verdict DÉFINITIF plaqué sur du crypto multi-TF.

## Catalogue (détection GÉOMÉTRIQUE causale — pivots confirmés i+k, JAMAIS d'extrema glissants comme ancres)

Port de `trader-pro-max-ultra/research/patterns2/detect2.py` (placebo 0,9 % ✓,
contrôle positif ✓ là-bas), adapté au moteur de pivots maison (`fractalPivots`,
causalité prouvée par test de troncature) :

1. Tête-épaules + inversée — 5 pivots alternés, proéminence tête ≥ prom,
   épaules symétriques ≤ tol, largeur 10-130, **neckline INCLINÉE par les 2
   creux extrapolée à la cassure**, tendance préalable requise (gate),
   signal = 1er close au-delà ≤ 40 barres après confirmation épaule D.
2. Doubles + triples sommets/creux — pivots H-L-H (+H-L-H-L-H triples),
   égalité ≤ tol, creux ≥ depth, cassure du pivot central.
3. Cup & handle + inverse — rims égaux ≤ tol, 30-300 barres, creux 25-75 % du
   span, profondeur ∈ [dmin, 50 %], rims intègres, anse ≤ min(prof/3, 12 %)
   au-dessus de la mi-coupe, ≥3 barres ; rondeur par fit quadratique (score).
4. Rounding top/bottom — fit quadratique sur les lows (resp. highs) entre 2
   rims, R² minimal, cassure du rim.
5. Wedges montant/descendant — ≥3 pivots hauts ET ≥3 bas, droites convergentes
   de MÊME signe de pente, cassure contre-pente ; **multi-résolution k
   OBLIGATOIRE** (la leçon G4 : effet stable à k∈{3,5,8} ou artefact).
6. Flags & pennants — mât = jambe pivot→pivot ≥ X %/ATR en ≤ M barres ;
   consolidation 3-15 barres contenue (drapeau : canal contre-pente léger ;
   pennant : convergence), retenue dans la moitié haute du mât ; cassure du
   plus-haut du mât (volume optionnel en score).
7. Triangles ascendant/descendant/symétrique — ≥3 touches par borne (pivots),
   borne plate vs oblique, cassure ; apex distance en score.
8. Canaux + lignes de tendance — 2+ pivots alignés ±0,3 ATR, rebond/cassure.
9. S/R horizontaux multi-touches — clusters de pivots ±0,5 ATR, ≥ min_touch,
   rebond (mèche ±0,3 ATR, close du bon côté) / cassure (±0,5 ATR), 4
   hypothèses (rebond S, rebond R, cassure S, cassure R).
10. Order blocks (BOS fidèle) — dernière bougie contraire avant close au-delà
    du dernier pivot confirmé en ≤ m barres ; retour DANS la zone.
11. Fibonacci ANCRÉ — jambe = couple pivot L→H adjacent (hausse ≥ seuil),
    niveaux 38,2/50/61,8 FIXES + **niveaux-placebo 25/75** (les ratios doivent
    battre l'arbitraire), zone ±8 % de jambe, invalidation au-delà des bornes.
12. Divergences prix/oscillateur — 2 pivots prix de même sens vs extrema RSI14
    (à la confirmation du 2ᵉ pivot), régulières + cachées.

## « Intelligemment placé » : score de qualité + dose-réponse (le cœur)

Score par instance ∈ [0,1], moyenne pondérée des critères du manuel :
tendance préalable (ampleur/netteté sur 40 barres), symétrie
(épaules/rims/touches), rondeur (R² du fit), profondeur & durée dans les
bornes canoniques, netteté des touches (distance moyenne aux lignes en ATR),
position de l'anse, **profil de volume** (pente dans la formation <0, ratio
cassure/formation >1 — le volume crypto est réel), proximité d'un niveau
majeur (S/R multi-touches ou extrême 250 barres). Poids FIGÉS avant tout
calcul (aucun ajustement post-hoc) ; publiés avec la galerie.

**Test décisif (H-B)** : terciles de score → fwd et trades par tercile. Dose-
réponse = T3 > T1 ET T3 > tout-venant, signe cohérent, null par rotation dans
chaque tercile. Sans ça, la famille est morte quelle que soit sa moyenne.

## Grilles (balayage large, BH-FDR à la mesure)

- k ∈ {3,5,8} × tol ∈ {1,5 %, 3 %} × gate tendance ∈ {0,1} (familles 1-2) ;
  paramètres propres par famille (prom, depth, dmin, bornes de durée,
  fenêtres de cassure 20/40/60, min_touch 2/3, seuil de mât…), ~10-30
  configs/famille, TOUTES consignées au ledger.
- TF : **1h, 4h, 1d** × actifs : **BTC, ETH** (IS/OOS) + réplication panier
  alts liquides USDT (top ~20 par volume, téléchargement à faire) pour les
  survivants.
- Découpage temporel : IS 2017-08→2024-01, OOS 2024-01→2026-07 (une passe,
  survivants IS seulement). ⚠ 2024→26 déjà vu par accum3/dayswing (consigné) —
  un survivant serait « à confirmer sur données vierges futures ».

## Évaluation double (pré-enregistrée)

1. **Event study** : fwd log-ret directionnel h ∈ {12, 30, 60 barres} (h
   primaire = 30), **null par rotation circulaire des événements** (1000,
   préserve clustering + dérive), p unilatéral ; BH-FDR 10 % PAR FAMILLE ;
   n ≥ 20 sinon « n insuffisant ».
2. **Trade canonique du manuel** : entrée à l'OPEN de la barre suivant la
   cassure, stop/objectif canoniques (mouvement mesuré), gaps servis à
   l'open, **stop PRIORITAIRE si stop+objectif même barre** (plus conservateur
   que le moteur — assumé), timeout 60 barres, coûts 30 bps AR (taker OKX
   0,10 % ×2 + slip 0,05 % ×2), stress ×2.

## Barre de survie (avant OOS — identique dans l'esprit à patterns2)

1. p_rotation < 0,01 en IS BTC, survivant BH-FDR 10 % dans sa famille ;
2. réplication de signe ETH IS (obs > 0 dans le sens de la figure) ;
3. dose-réponse POSITIVE (T3 > T1, même signe, p_T3 < 0,05) ;
4. trade canonique : espérance > 0 net en IS ;
5. OOS une passe : même signe, p < 0,05, ampleur ≥ 50 % de l'IS ;
6. porte économique : ≥ +30 bps/trade net en OOS.
Survivant complet → phase stratégie complète (régime+sizing+WF) avant tout mot
à Mario au-delà de « candidat ».

## Garde-fous machinerie (avant IS, bloquants)

- **Placebo** : pipeline COMPLET (détection+score+event study+trades) sur 2
  marches aléatoires GBM calées sur la vol BTC 4h → ~1 % de stats à p<0,01,
  ≤3 % toléré, sinon stop.
- **Contrôle positif** : la machinerie doit retrouver le breakout
  Donchian×volume 4h (l'edge maison GO, percentile 95 re-vérifié en audit1)
  reformulé en « cassure de S/R multi-touches haussière en bull » ou canal —
  attendu obs > 0, p < 0,05. Si elle ne le retrouve pas, machinerie suspecte.
- Galerie SVG systématique par famille (port render_gallery.py, ancres
  exactes, stops/objectifs, échantillons HAUT et BAS score) publiée en
  artifact — l'audit visuel de Mario fait partie de la boucle.

## Indicateurs classiques (volet 2, après le géométrique)

Standalone (déjà large fait par wide1/families — compléter Ichimoku, SAR en
système, OBV/VWAP en confluence) PUIS **confluence par synergie de
permutation** (p_syn : sous-ensemble aléatoire de même taille, 2000 tirages —
battre l'entrée seule, leçon confluence1) : entrées = cassures des familles
survivantes (ou Donchian si zéro), confirmations = RSI/stoch/MACD/BB/ADX/
volume/VWAP/Ichimoku, 1 à 3 facteurs. Configurations d'usage réelles
(overbought/oversold classiques, croisements, nuage), pas d'hommes de paille.

## Journal

- 2026-07-15 : protocole écrit et committé avant toute exécution. Données
  BTC/ETH 1h/4h/1d canoniques prêtes (base 5438) ; alts USDT à télécharger.
  Prochaine session : garde-fous (placebo + contrôle positif) PUIS IS.
