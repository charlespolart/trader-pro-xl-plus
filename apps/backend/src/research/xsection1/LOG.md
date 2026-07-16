# xsection1 — cross-section alts USDT (protocole pré-enregistré)

**Ouvert le 2026-07-15, committé AVANT toute exécution.** Horizon H1 de la
ROADMAP. Mission-cadre : trouver une stratégie qui bat les incumbents (cible
mesurable définie dans ROADMAP.md) — ou réfuter proprement.

## Mécanisme économique & priors

Dispersion énorme entre alts, flux retail par vagues d'attention, lead-lag
depuis les majors → momentum/réversion/low-vol EN COUPE (acheter les forts,
vendre les faibles, en relatif). Littérature (Liu-Tsyvinski-Wu et suiv.) :
momentum 1-4 semaines en coupe documenté, décroissant post-2021.

**Priors maison (honnêteté — 3 angles voisins déjà RÉFUTÉS)** : rotation
top-k \*/BTC pour accumuler du BTC (accum3 : −100 %) ; panier satellite
ETHBTC/SOLBTC (accum5 : 2 looks OOS épuisés, fermé) ; rotation de récolte de
funding (carry1 R1 : persistance réelle mais rotation < hold). **L'angle
VIERGE testé ici : coupe en USD, jambes longues ET courtes (market-neutral)
+ long-only vs benchmark équipondéré.** Ce qui est mort : « tourner entre
alts pour battre le hold d'un actif fort ». Ce qui est vierge : « le SPREAD
fort-faible en USD est-il un facteur net de coûts ? »

## Données & LIMITE ASSUMÉE (survivorship du pilote)

- Panel : top-20 alts USDT par liquidité ACTUELLE (BNB, SOL, XRP, ADA, DOGE,
  AVAX, LINK, DOT, LTC, MATIC, ATOM, UNI, NEAR, FIL, ETC, XLM, ALGO, VET,
  TRX, EOS), spot Binance 1d (grain primaire), 2019-01→2026-07, base 5438.
  Entrée dans le panel : à partir de la 91ᵉ bougie du symbole (warmup J max).
- ⚠ **Univers = survivants d'aujourd'hui → biais haussier sur les jambes
  LONGUES et adoucissant sur les jambes courtes.** Statut de campagne : PILOTE
  de dépistage. **Aucun candidat ne sera annoncé sans réplication sur
  l'univers survivorship-safe** (toutes les paires USDT ayant existé,
  délistées incluses — reconstructible depuis Vision comme l'univers \*/BTC
  489 paires de accum3). Un facteur MARKET-NEUTRAL (long−short) est moins
  exposé au biais que le long-only ; consigné par facteur.
- Frais : 30 bps par CÔTÉ de rotation (taker 0,10 % + slip 0,05 % ×2 marges) ;
  le turnover est mesuré et facturé sur le notionnel TOURNÉ. Stress ×2.
  (Le maker OKX réel serait moins cher — on teste au taker, conservateur.)

## Facteurs & grilles (FIGÉES — aucune optimisation dans cette passe)

Signal calculé au close du jour t, positions prises à l'OPEN de t+1 (open+1,
convention moteur), tenues K jours, jambes équipondérées, re-normalisées à
chaque rebalancement.

| Famille | Signal (à t) | Grille | # |
|---|---|---|---|
| MOM | log-ret sur J jours, skip S derniers | J∈{7,14,30,90} × S∈{0,2} × K∈{2,7} | 16 |
| REV | log-ret sur J jours (inversé) | J∈{1,3} × K∈{1,2} | 4 |
| LOWVOL | −σ des rets 1d sur 30 j | K∈{7,30} | 2 |
| CARRY | funding cumulé 7 j du perp (si dispo base 5436→export) | K∈{2,7} | 2 (sinon consigné « non testé ») |

Portefeuilles par facteur : **L/S** = long top-30 % (6 noms) − short
bottom-30 % (6) ; **LO** = long top-30 % seul. Benchmarks : EW-20 (long-only)
et 0 (L/S). Total ≈ 24 configs × 2 constructions = 48 stats primaires,
ledger complet, BH-FDR 10 % PAR FAMILLE sur la stat primaire.

## Éval & nulls (pré-enregistrés)

- Primaire : **Sharpe net annualisé** de la série quotidienne du portefeuille
  (√365) sur l'IS. Null : **permutation des rangs en coupe** — à chaque
  rebalancement, les rangs du signal sont mélangés entre les actifs VIVANTS ce
  jour-là (structure temporelle et coûts identiques, information de coupe
  détruite), 1000 tirages → p = P(Sharpe_null ≥ Sharpe_obs).
- Secondaire (survivants) : monotonie des quintiles (Q5−Q1 même signe que
  L/S, progression), turnover, maxDD, sous-périodes (2019-21 vs 2022-23).
- **Placebo machinerie** : pipeline COMPLET sur panel à rendements mélangés
  par blocs de 30 j PAR ACTIF (détruit coupe ET momentum, garde les
  distributions) → ~1 % de stats à p<0,01, ≤3 % toléré, sinon stop.
- **Contrôle positif** : facteur PLANTÉ — +20 bps/j injectés sur 4 actifs
  fixes d'un panel placebo → le pipeline MOM doit les retrouver à p<0,01,
  L/S Sharpe net > 1. Sinon machinerie suspecte, stop.

## Barre de survie (avant OOS — inamovible)

1. IS 2019-07→2024-01 : p_perm < 0,01, survivant BH-FDR 10 % par famille ;
2. L/S : Sharpe net ≥ 0,8 ET maxDD < rendement annualisé (Calmar > 1) ;
   LO : bat EW-20 (ΔCAGR ≥ +3 pts ET DD ≤) ;
3. quintiles monotones (pas juste les extrêmes) ;
4. plateau : les voisins de grille (J±1 cran, K±1 cran) gardent ≥ 50 % du
   Sharpe ;
5. coûts ×2 : Sharpe net > 0,5 ;
6. OOS 2024-01→2026-07 UNE passe : même signe, Sharpe ≥ 50 % de l'IS ;
7. **réplication survivorship-safe OBLIGATOIRE** (univers complet délistées
   incluses) avant tout mot au-delà de « candidat pilote » ;
8. porte finale : comparaison aux incumbents selon ROADMAP (duel direct ou
   contribution portefeuille), WF ancré.

## Journal

- 2026-07-15 : protocole écrit et committé avant exécution. Téléchargement
  top-20 en cours (ensure_alts.ts). Machinerie : xsection.py à écrire
  (panel → facteurs → éval permutation → placebo/contrôle → IS).

## GARDE-FOUS (2026-07-15) — le placebo a réparé le null LUI-MÊME (ledger complet)

1. Placebo v1 : 48/48 « hits » — BUG du harnais (panel reconstruit depuis le
   jour 0 de la grille → NaN propagés, Sharpe NaN compté comme hit). Corrigé
   (reconstruction par actif depuis SA première cote ; p=NaN si Sharpe NaN).
2. Placebo v2 : 22/48 — **null par rangs re-tirés CONDAMNÉ** : re-tirer les
   rangs à chaque rebalancement = turnover maximal = coûts maximaux → tout
   signal PERSISTANT bat le null sur bruit pur par la seule économie de
   frais. **Null officiel remplacé : RÉÉTIQUETAGE de colonnes** (une
   permutation d'actifs par tirage — persistance/turnover préservés,
   alignement coupe↔rendements détruit).
3. Placebo v3 : 10,4 % — les blocs de 30 j laissaient fuir le momentum court
   intra-bloc. Placebo machinerie passé en mélange iid jour par jour.
4. **Placebo final : 0/48 à p<0,01 ✓.**
5. Contrôle planté v1 (+20 bps/j sur SOL/AVAX/LTC/NEAR) : NON retrouvé — mal
   conçu (3 plantés listent fin 2020 ; ampleur sous le bruit de rang : 31 %
   des slots du top seulement). v2 (+40 bps/j, 4 actifs 2019) : p=0,057.
   **v3 (+60 bps/j) : Sharpe 1,46, p=0,0033 ✓ RETROUVÉ.**
6. **Courbe de puissance consignée** (pré-cadre la lecture de l'IS) : à 20
   actifs, l'instrument ne certifie à p<0,01 que des facteurs ÉNORMES
   (~+60 bps/j sur 4 noms). Un facteur réel modéré passera sous le radar du
   pilote → la réplication univers-complet (40-100 actifs, délistées
   incluses) n'est pas qu'anti-survivorship : c'est le VRAI test de
   puissance. Le null par réétiquetage est « contaminé » par construction
   (les tirages détiennent le panel drifté au hasard) : le test mesure la
   SÉLECTION au-delà de la composition du panel — c'est la bonne question.

## IS PILOTE (2026-07-15) — verdict : 0 survivant complet, une texture réelle sous-dimensionnée

48 stats, 1000 permutations de réétiquetage, net 30 bps/côté. Benchmark
EW-20 (sans frais) : Sharpe +0,29, CAGR +29,9 %, DD 85,0 %.

- **MOM : 1 seul BH — J30,S0,K2 L/S : Sharpe +0,44, CAGR +29,5 %, DD 51,4 %,
  p=0,005** → **échoue au critère 2** (Sharpe < 0,8 ; Calmar 0,57 < 1). La
  barre ne bouge pas : pas d'OOS. Texture cohérente autour (rangée J30 toute
  positive, S0>S2, K2>K7, J14-K7 positif) — pile dans la zone « sous le
  radar » pré-annoncée par la courbe de puissance.
- LO : jamais BH (best p=0,086) ; les CAGR +30-54 % ≈ le bêta EW-20 (+29,9 %)
  — pas de sélection démontrée.
- **REV : massacré par les frais** (−45 à −96 % CAGR, turnover quotidien ×
  30 bps) — réfuté sans ambiguïté au grain 1d.
- LOWVOL : rien (p ≥ 0,32).
- CARRY (funding contrarien) : K2 L/S p=0,026 vs seuil BH intra-famille
  0,025 — LOUPÉ d'un cheveu, Sharpe 0,12 seulement ; cohérent avec carry1
  (« persistance réelle mais petite »).

**Suite pré-inscrite (barre inchangée)** : réplication sur l'UNIVERS COMPLET
USDT (délistées incluses) = le vrai test — la largeur (60-100+ noms
simultanés) multiplie la puissance ET tue le survivorship. Si MOM-30 L/S y
franchit p<0,01 BH + Sharpe ≥ 0,8 + quintiles + plateau + coûts ×2, ALORS
l'OOS 2024→26 sera dépensé. Sinon : H1 rejoint les angles réfutés.

## UNIVERS COMPLET (2026-07-16) — MOM tué par le survivorship, LOWVOL surgit

Panel : 564 symboles ≥180 j (délistées incluses), **258 vivants médians IS**
(×13 le pilote). Placebo échelle univers : 0/44 ✓. Parité vectorisé↔pilote
exacte (5,6e-17) après 2 bugs attrapés par la barrière (min_alive, jour-
frontière).

1. **MOM : le pilote était un ARTEFACT DE SURVIVORSHIP.** Sur l'univers vrai,
   TOUTES les configs momentum s'effondrent (−25 à −77 %/an ; la J30-K2 du
   pilote passe de +29,5 % à −59,5 %). Acheter les gagnants récents parmi les
   futurs morts perd. Pièce d'exposition méthodologique — l'étage univers
   valait à lui seul la campagne.
2. REV : p=0,001 avec Sharpe −1,2..−6,1 — il y a de l'information de coupe
   1-3 j RÉELLE (les nulls réétiquetés font PIRE) mais broyée par les coûts
   taker. Non exploitable en l'état ; noté pour un éventuel angle maker.
3. **LOWVOL L/S : Sharpe +1,03/+1,17, +47-51 %/an, DD 47 %, p=0,001-0,002 BH
   — PREMIER candidat de la mission à franchir le critère 2.** Instruction :
   quintiles PARFAITEMENT monotones (Q1 vol-max −328 bps/30 j → Q5 +110) ✓ ;
   sous-périodes 2019-21 +1,40 / 2022-23 +0,98 ✓ ; plateau σ{20-60}×K{7-30}
   ENTIER positif 0,82-1,47 ✓ ; coûts ×2 Sharpe 0,94, ×3 0,71 ✓.
4. **Trop-beau — le nerf du candidat est la jambe SHORT** (junk volatil) :
   les jambes séparées sont faibles (long +0,15, short +0,29 avec DD 95 %),
   c'est le SPREAD qui annule le bêta et isole le facteur ✓ mécanique saine —
   MAIS **176 séries délistées, log-ret moyen des 30 derniers jours −86 %** :
   le backtest encaisse au short des agonies terminales que le réel ne peut
   pas capturer (borrow rare/cher, règlement forcé).
5. **Étape décisive pré-déclarée AVANT exécution : variante IMPLÉMENTABLE** —
   jambe short restreinte aux noms ayant un PERP Binance ACTIF à la date
   (fenêtre d'existence lue dans perp_funding, 791 perps) + FUNDING facturé
   au taux réel de la position short (reçu si positif, payé si négatif) ;
   jambe longue inchangée (spot). Même barre : Sharpe ≥ 0,8, Calmar > 1,
   coûts ×2 > 0,5. Si ça tient → OOS unique 2024→26. Sinon : candidat réduit
   à un artefact d'inexécutabilité, consigné.

## VARIANTE IMPLÉMENTABLE (2026-07-16) — verdict : ÉCHEC au critère 2, le plus proche de la mission

Shorts restreints aux perps Binance ACTIFS à la date (445/564 couverts,
fenêtres lues dans perp_funding ; exclusion du dernier jour = conservateur),
funding facturé au taux réel. Résultat sur les DEUX cellules BH
pré-enregistrées :

| cellule | Sharpe | CAGR | DD | Calmar | verdict (barre 0,8 ET 1,0) |
|---|---|---|---|---|---|
| K30 ×1 | **+0,84** | +50,3 % | 59,4 % | **0,85** | ✗ Calmar |
| K30 ×2 | +0,68 | +39,1 % | 60,0 % | 0,65 | (coûts ×2 > 0,5 ✓) |
| K7 ×1 | +0,72 | +47,7 % | 62,3 % | 0,76 | ✗✗ |

- ~30 % du facteur abstrait vivait dans du junk NON shortable (Sharpe
  1,17 → 0,84) ; la jambe short implémentable = ~29 noms (vs 77) → DD 47→59 %.
- **Découverte à garder : le FUNDING est un vent porteur massif (+72,9 %
  cumulés REÇUS par les shorts sur l'IS)** — le junk pompé paie ses shorts ;
  cohérent H2/H7 de la ROADMAP.
- **Pas d'OOS consommé** (critère 2 non tenu). La barre n'a pas bougé.

**Extension pré-enregistrée pour la passe suivante (hypothèses de
CONSTRUCTION, barre inchangée)** : (a) vol-targeting du L/S (cible 20 %
annualisée, fenêtre 30 j — mécanique H7, améliore le Calmar si les queues ne
dominent pas) ; (b) jambe short élargie (TOPQ court appliqué au sous-univers
shortable ENTIER plutôt qu'à l'intersection) ; (c) overlay bêta-hedge BTC.
Chaque variante = une ligne de ledger, BH sur l'ensemble, et OOS UNIQUE
seulement si critère 2 tenu. Sinon : H1 consigné « facteur réel,
inexploitable à nos contraintes », et on passe à H2/H7.
