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

## GARDE-FOUS (2026-07-15) — passés, avec un amendement d'instrument consigné

1. **Placebo** : pipeline complet (12 familles × grilles) sur 2 GBM calées vol
   BTC 4h → **1/349 stats à p<0,01 = 0,3 %** (attendu ~1 %, toléré ≤3 %) ✓.
2. **Edge planté** (auto-test évaluateur) : +2 %/30b injecté sur GBM →
   p=0,002 ✓ — l'évaluateur détecte ce qui existe.
3. **Contrôle positif — le ledger complet, y compris les échecs :**
   - tentative 1 : Donchian55×vol en bull, événements BRUTS → +174,7 bps,
     p=0,105 ✗ (clusters chevauchants diluent l'obs) ;
   - tentative 2 : + réfractaire 30 barres (forme fidèle à la stratégie) →
     +205,7 bps, p=0,058 ✗ ; horizons pré-déclarés 12/60 : 0,31/0,087 ✗ ;
   - contrôle VRX (edge ÉVÉNEMENTIEL maison, survivant BH accum3, répliqué
     ETH, en prod) BTC seul : +49 bps, p=0,14 ✗ (n=91 — validé à l'origine
     par IC sur ~14 000 barres, pas sur 91 croisements) ;
   - **diagnostic** : l'instrument « fwd horizon fixe + rotation » est PROPRE
     (placebo) mais SOUS-PUISSANT à n<100-150 face à la dérive BTC — les deux
     edges maison réels y sont positifs sans certification. Un « 0 survivant »
     IS sous cet instrument n'aurait aucune valeur probante.
   - **AMENDEMENT pré-enregistré (encore en phase garde-fous, AVANT tout IS
     figuré)** : le verdict par famille se prend au niveau **POOLÉ BTC+ETH**
     (détection par actif, null = rotation circulaire indépendante par
     segment combinée par la moyenne jointe — `lib.eval_events_pooled`). La
     réplication devient de la puissance ; la barre (obs>0, p<0,05, BH-FDR
     10 % par famille) ne bouge pas.
   - **Contrôle VRX sous l'instrument poolé : n=177, +87,6 bps, p=0,044 ✓ —
     RETROUVÉ.** (Donchian poolé : +182,4 bps, p=0,0509 — à la frontière,
     cohérent avec sa nature d'edge « coureur » que l'horizon fixe
     sous-mesure ; son instrument propre reste le WF stratégie, re-validé en
     audit1 à percentile 95,0.)

## Journal

- 2026-07-15 : protocole écrit et committé avant toute exécution. Données
  BTC/ETH 1h/4h/1d canoniques prêtes (base 5438) ; alts USDT à télécharger.
- 2026-07-15 (suite) : lib.py (pivots vérifiés identiques au moteur TS,
  rotation, trades stop-prioritaire, BH), detect.py (12 familles fidèles +
  sous-scores qualité à poids égaux figés), run.py (grilles ~230 cfg/TF).
  Garde-fous passés (ci-dessus, placebo 0,3 %, contrôle VRX poolé p=0,044).
- 2026-07-15 (IS 4h poolé BTC+ETH, <2024-01, h=30, ~206 configs) — PREMIER
  BALAYAGE, à confirmer (rien n'est un candidat avant dose-réponse robuste +
  trades + OOS) :
  * **17 configs BH** (10 % par famille), concentrées dans : **CUP** (4/8,
    best +332,6 bps p=0,019 n=65), **ROUND** (5/16, best TOP +438,0 p=0,003
    n=41), **TRI** (5/12, best sym +199,3 p=0,013 n=169), **TT** (1/12,
    +183,8 p=0,007 n=143), **SR** (2/16, dont sup_break +128,2 p=0,005
    n=201). Thème cohérent : figures de retournement CÔTÉ SHORT + cup/
    triangles côté long. HS bear best p=0,007 mais sous le seuil BH de sa
    grille (24 cfg). iHS/iCUP/DT/DB/WEDGE/FIB/OB/DIV/TB/TL : 0 BH.
  * Règle du trop-beau appliquée à ROUND top : dates étalées
    2018/20/21/22/23 (pas un cluster), directions saines, MAIS l'événement
    COVID 2020-03-08 (+3 647 bps) porte ~165 bps de la moyenne à lui seul →
    stats robustes (médiane/trimmed) OBLIGATOIRES à la prochaine passe.
  * Dose-réponse (configs canoniques seules) : ✓ sur TL uniquement
    (T3 +190,2 vs T1 +98,4, p=0,044) ; la plupart des familles n'ont pas
    assez d'événements à config unique → la prochaine passe fera les
    terciles sur configs POOLÉES par famille (dédupliquées par sig).
    Bug relevé : terciles dégénèrent quand les scores sont très liés
    (SR : T3 vide) — à corriger (départage aléatoire stable).
  * Trades canoniques (BTC, configs canoniques) : tout t<1,5, DB/TB
    négatifs — rien de tradable à ce stade.
  * FLAG/PENN : n quasi nul partout → constructions trop strictes
    (mât ≥6×ATR/15b + rétention moitié haute + forme) — à desserrer et
    re-valider au placebo avant la passe 2.
  * À FAIRE (passe 2) : stats robustes sur les 17 BH ; dose-réponse poolée
    par famille ; galerie SVG (audit visuel Mario) ; réplication 1h/1d ;
    trades canoniques des BH ; OOS UNE passe à la toute fin. survivors_is.json
    committé.

## PASSE 2 (2026-07-15) — stats robustes + dose-réponse poolée

Incident machine en cours de passe : Docker/PG retombés (ENOSPC hôte pendant
une rafale d'écriture — même schéma que le matin), relancés ; volume master
redondant libéré (~1,4 G ; chaîne de garde intacte : original corrompu +
tarball + v2 vivant). ⚠ Disque à surveiller en début de chaque session.

**Stats robustes sur les 17 BH** (barre pré-déclarée : méd>0 ET trim10>0 ET
p_trim<0,05) → **12/17 retenues** (`survivors_robust.json`). Le filtre a mordu
juste : TRI desc tués (médianes NÉGATIVES −60/−45 — moyennes portées par les
extrêmes), ROUND top k5,r0.5 et CUP k8,d0.1 tués. Profils des retenues :
- **CUP bull (3 cfg) : médianes +347/+473/+362, p_méd 0,004-0,038** — robuste
  au sens fort, pas un artefact de crash ;
- **ROUND bottom (2 cfg) : médianes +296/+362** — idem ;
- ROUND top (2), TT (1), SR sup_break (2) : retenues par la moyenne tronquée
  (p 0,003-0,047) mais médianes faibles (+5 à +89) — queues grasses des bears,
  fragilité consignée ;
- TRI sym gated (2) : médianes +140/+116, trim p=0,020.

**Dose-réponse poolée par famille** (toutes configs, dédup par sig, départage
déterministe — barre : T3>T1, T3>tous, p(T3)<0,05) :
- **TRI : ✓ (T1 +34 → tous +95 → T3 +177, p=0,023)** — seule famille où le
  score de qualité chartiste a un contenu démontré ;
- CUP : monotone dans le bon sens mais p=0,053 → ÉCHEC au critère 3 tel que
  pré-enregistré (noté borderline : les DEUX terciles sont fortement positifs,
  l'effet famille domine le gradient de qualité) ;
- ROUND : plat (T1 +234 / T3 +209) — l'effet n'est pas porté par la qualité ;
- **ANTI-dose-réponse** (la « qualité » du manuel fait PIRE) : TB (+238 →
  −78 !), TL (+22 → −34), iHS (+25 → −160) — le folklore inversé, consigné ;
- FLAG/PENN toujours n quasi nul (constructions à desserrer avant toute
  conclusion sur ces familles).

**État de la chaîne de survie** (critères 1-6 du protocole) : TRI sym gated
passe 1-3 ; tout le reste échoue au critère 3 (ou aux robustes). À faire :
critère 4 (trades canoniques) pour TRI, galeries SVG, réplication 1h/1d,
puis OOS UNE passe pour les survivants complets uniquement.

## PASSE 2 (suite) — critère 4, réplication 1d, et l'OOS

**Critère 4 (trades canoniques, 30 bps AR, stop prioritaire)** sur les 12
robustes : TRI sym k3,g1 → **BTC +148,6 bps/tr net (t=+2,1, n=81), ETH +39,3**
✓ ; TRI sym k5,g1 → +108,5/+44,1 ✓ ; TT bear → BTC −11,0 ✗ (mort) ; CUP k5
BTC +83,2 (win 21 % — l'objectif canonique rarement atteint) mais **ETH +622,0
(t=+3,7)** ; ROUND bottom k8 BTC +51,2, **ETH +557,9 (t=+3,5)** ; SR sup_break
N/A (pas de stop/objectif canonique). CUP/ROUND restent morts au critère 3
(dose-réponse 0,053/plat) malgré ces trades ETH spectaculaires — consigné pour
mémoire, la barre ne bouge pas.

**Réplication 1d** (balayage complet) : TRI sym/k3,g1 **BH sur 1d aussi**
(n=25, +1 373 bps, p=0,006) — même construction, TF indépendant. Autres
familles : n insuffisant partout sur 1d (figures quotidiennes rares), sauf
SR res_break p=0,058 (sous BH) et TL dose-réponse ✓ 1d (T3 +1 187, p=0,035).

**OOS UNE PASSE (2024-01→2026-07, consommé pour TRI sym gated uniquement)** :

| config | IS poolé | OOS poolé | verdict |
|---|---|---|---|
| TRI sym k3,g1 | +199,3 bps | **−25,5 bps (p=0,59)**, trades BTC −50,8 / ETH −27,8 | **ÉCHEC — flip de signe** |
| TRI sym k5,g1 | +251,4 bps | **−54,7 bps (p=0,71)**, trades BTC +20,5 / ETH −169,3 | **ÉCHEC — flip de signe** |

1d OOS : n=8 (insuffisant). Le flip de signe IS↔OOS est la signature du bruit
(patterns1). **La seule famille ayant franchi les critères 1-4 meurt au
critère 5.** L'OOS des autres familles n'a PAS été consommé (mortes avant).

**État du chantier après passe 2** : 0 survivant complet. Restent au
protocole avant verdict définitif de la campagne : balayage 1h (grille
light), desserrage FLAG/PENN + re-placebo (les 2 seules familles jamais
vraiment testées faute d'événements), galeries SVG (audit visuel), volet 2
indicateurs/confluence. Les caveats déjà actés : OOS 2024→26 sans bear
soutenu ; CUP/ROUND ont des médianes IS robustes et des trades ETH forts mais
pas de dose-réponse — s'il faut les rejuger un jour, ce sera sur données
VIERGES futures, pas en repassant le même OOS.

## PASSE 2 (fin) — 1h, galerie

**Balayage 1h (grille light)** : 14 candidats BH mais la COHÉRENCE multi-TF
des familles fortes du 4h est absente : CUP sur 1h = ANTI-dose-réponse
(T1 +114 → T3 −6) ; le TRI qui ressort au 1h est la variante desc (p=0,001,
n=275) — celle-là même que les médianes ont tuée sur 4h ; TT 1h dose plate.
Une famille réelle garderait sa forme à travers les grains — encore la
signature du bruit. Ledger complet dans les sorties de run.

**Galerie SVG publiée** (artifact 📐 e023f25c) : 13 familles, ancres exactes,
3 HAUT + 3 BAS score chacune, verdicts en chips — l'audit visuel de Mario
peut commencer. `gallery.py` committé (régénérable).

**Bilan chantier à ce point** : 0 survivant complet après 2 passes ;
restent au protocole : FLAG/PENN desserrés + re-placebo, volet 2
indicateurs/confluence (synergie par permutation), et — si Mario le veut —
réplication alts USDT. Les leçons acquises (dose-réponse comme juge de paix,
pooling de puissance, robustes anti-crash) sont dans lib/pass2 réutilisables.

## PASSE 3 (2026-07-15) — AUTO-AUDIT VISUEL (captures d'écran) → v2 des détecteurs

Demande de Mario : vérifier MOI-MÊME visuellement chaque graphe (captures
Chrome headless par famille, bougies OHLC ajoutées au rendu — les pivots
s'ancrent sur les mèches, il faut les voir). `screenshots.py` + `shots/*.png`.

**Défauts trouvés en REGARDANT (aucun n'était visible dans les chiffres) :**
1. **TRI/WEDGE : fuite d'apex** — signaux tirés APRÈS le croisement des
   droites (3 cartes), où « casser la ligne » n'a plus de sens. La contrainte
   b < x_apex retire **~55 % des événements TRI** (84→38 sur BTC).
2. **TRI : affichage ≠ décision** — la droite basse était ajustée sur 3
   pivots mais les ancres n'en stockaient que 2. Corrigé (mêmes points).
3. **HS : necklines verticales** — des « H&S » à neckline plus pentue que la
   hauteur de tête (2023-11, 2023-06, HAUT score !) qu'aucun chartiste ne
   tracerait ; et épaules à >3× d'écart temporel. v2 : plafond
   |pente|×largeur ≤ 0,5×hauteur_tête + symétrie temporelle ≤3×. Effet :
   n 40→21 poolé, signal +365→+566 bps (p=0,011) — la fidélité paie, mais
   toujours sous BH. Le score classait MAL cette famille (les vrais H&S
   d'août 2022/juin 2022 étaient en BAS score — sous-score volume trop dur).
4. **CUP/ROUND : multiplicité d'épisodes** — le même sommet/base compté 2-3
   fois via des paires de rims différentes (cartes 1-2 de ROUND top = le même
   top de juillet-août 2023). v2 : dédup par chevauchement de fenêtres >50 %
   (ROUND top n 41→29).
5. Wedge déc-2017 détecté avec des lignes lâches (touch=0,16) mais score haut
   (dilution des poids égaux) — consigné, poids inchangés (figés).
6. CUP/ROUND : constructions LÉGITIMES à l'œil (vraies soucoupes en haut
   score, V-junk correctement déclassé) — lecture : ce sont des cassures de
   base (l'edge breakout déguisé), pas de bug.

**Re-validation v2 (mêmes barres, rien ne bouge) :** placebo **0/319 = 0,0 %**
✓ ; IS 4h poolé re-balayé : 17 BH (composition changée), robustes **11/17**
(CUP médianes renforcées +348/+410/+498 ; TRI sym k3,g1 TOMBE, trim p=0,057 —
l'évidence v1 vivait dans la moitié post-apex) ; **dose-réponse v2 : AUCUNE
famille ✓** — TRI perd son unique ✓ (T3 +143, p=0,110), ROUND s'INVERSE
(T1 +302 > T3 +86), CUP plat (+364/+344/+338).

**VERDICT GÉOMÉTRIQUE (quasi définitif, 3 passes + auto-audit visuel) :**
constructions fidèles, durcies par l'œil, placebo propre, contrôle positif
poolé ✓ — et AUCUNE famille ne franchit la chaîne complète. L'hypothèse H-A
(« mal placé ») est réfutée par construction (les placements sont maintenant
vérifiés à l'œil) ; H-B (dose-réponse) est réfutée partout — le seul ✓ v1
était un artefact de construction. Ce qui reste de réel : des cassures de
base/plus-hauts à médianes fortes (CUP/ROUND bottom) = l'edge breakout maison
sous un déguisement chartiste, sans que la « qualité » du tracé n'y ajoute
rien. Galerie v2 republiée (bougies OHLC, artifact 📐 e023f25c).
Restent au protocole : FLAG/PENN desserrés + volet indicateurs/confluence.
