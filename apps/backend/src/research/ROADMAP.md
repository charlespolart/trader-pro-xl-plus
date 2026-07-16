# ROADMAP — carte d'exploration (mission 2026-07-15, multi-sessions)

**Règle de mission (Mario, 2026-07-15, prioritaire)** : la mission ne s'arrête
pas tant qu'aucune stratégie VALIDÉE ne rapporte plus d'argent que les
stratégies actuelles. Corollaires non négociables :

- **La barre ne bouge JAMAIS.** Chercher plus longtemps = couvrir PLUS
  d'espace avec la même rigueur, jamais retester le même espace jusqu'à
  l'aveu. Un mirage finirait en argent réel perdu ; un « réfuté » démontré est
  un livrable.
- **Carte épuisée = carte à ÉTENDRE** (nouvelles données, nouveaux grains,
  nouvelles venues), pas une condition d'arrêt.
- Recherche PURE : aucune modification du runtime live/bots/config/prod sans
  GO explicite. Problème détecté sur une stratégie live → alerte immédiate.

## La cible à battre (définition mesurable, figée)

Les « stratégies actuelles » et leurs chiffres de référence (re-vérifiés en
audit1/A5) :

| Incumbent | Dénomination | Référence (fenêtre, net de frais) |
|---|---|---|
| btc-accumulator | base (BTC) | 2019-01→2026-06 : **+61,9 % BTC**, DD −29,6 % ; WF 2018→26 : +77,6 % |
| btc-vrx | base (BTC) | IS 2018-04→2024-01 : **+243,7 % BTC**, DD −29,1 % ; OOS 24→26 : +16,9 % |
| duo accum+vrx 50/50 | base (BTC) | IS : rendement conservé, **DD −19,5 %** |
| btc-swing | quote (USD) | 2019-01→2026-01 : **+474,3 %**, PF 1,85, DD −40,6 % ; WF +390 % (5/6) |
| eth-accumulator | base (ETH) | baselines de son en-tête (à re-vérifier A5) |

**« Rapporte plus »** = l'un des deux, à risque comparable et net de tout :

1. **Duel direct** : dans SA dénomination, sur les mêmes fenêtres (IS + OOS +
   WF ancré), CAGR supérieur À DD égal ou moindre (ou CAGR égal à DD
   nettement moindre) ; OU
2. **Contribution portefeuille** : ajouté au portefeuille de bots à risque
   total constant, il augmente le rendement composite (corrélation faible aux
   moteurs existants exigée, recouvrement des excursions mesuré comme
   accum×vrx = 27 %).

Et dans TOUS les cas : survie à l'arsenal complet (ci-dessous). Une stratégie
qui « bat » sans arsenal complet n'existe pas.

## Arsenal obligatoire (chaque campagne, sans exception)

1. Protocole pré-enregistré committé AVANT (hypothèses, grilles, barre chiffrée).
2. **Placebo** : pipeline complet sur bruit → ~1 % de faux positifs à p<0,01,
   sinon stop machinerie.
3. **Contrôle positif** : la machinerie doit RETROUVER un edge maison validé
   (mécanique d'excursion v2, variance ratio, Donchian×volume, carry hold).
4. Nulls : rotation circulaire (événements clusterisés) / décalage circulaire
   FFT (lib.py) / timing-aveugle apparié (percentile ≥ 95 = LA barre maison) ;
   **synergie par permutation** pour tout combo (battre son meilleur
   ingrédient seul).
5. BH-FDR 10 % durci avec la taille de la grille ; ledger de TOUT essai.
6. **Bande placebo de la machinerie de sélection** (WF complet sur bruit) =
   étalon de lecture des vrais résultats.
7. **Règle du trop-beau** : résultat au-dessus de l'attendu → audit avant
   annonce. Galerie SVG pour tout ce qui se trace. Erratum committé sans se
   défendre si bug trouvé.
8. Frais d'abord : taker 0,10 % + slippage 0,05 % (OKX spot mesuré), funding
   pour les perps, stress ×2/×3. Event study close→close = mesure de
   SÉPARATION, jamais un backtest — requalifier avant tout chiffre publié.

## Phase 1 — Audit des fondations : ✅ TERMINÉ le 2026-07-15 (session 1)

→ `audit1/LOG.md`. Verdict : **les fondations tiennent** — indicateurs 41/41 à
la précision machine vs Python indépendant ; moteur accordé à 0,0000 pt de
CAGR avec une comptabilité indépendante (390 fills) ; données canoniques
saines (agrégations 3d/1w exactes, artefacts de venue documentés) ; stratégies
live reproduites AU TRADE PRÈS, validations-phares re-exécutées (swing
percentile 95,0 exact, accumulator 98,0 — null reconstruit, désormais dans
l'arbre) ; classes de bugs actions absentes des chemins porteurs (errata
mineurs consignés accum2/dayswing). **Forensic FERMÉ (GO Mario 15-07)** :
ancienne base réparée sur copie (Coinalyze/funding récupérés à l'identique),
diff bougies = prix 100 % identiques, écarts A5 expliqués au centième par le
changement feeMargin délibéré cd5845c (preuve : stratégie du 04-07 rejouée =
baseline exacte), baselinecheck re-basé 8/8 vert, dev 5436 rebranché.
Seul reste ouvert : fenêtre aveugle du stop i+2 backtest-vs-live (note A3, à
trancher par Mario un jour — sans urgence, direction conservatrice).

## Chantier dédié OBLIGATOIRE — catalogue chartiste complet (patterns-crypto)

Exigence explicite. L'inventaire (2026-07-15) montre que presque tout le
folklore a déjà été testé ICI et réfuté (S/R pivots/ronds/volume-profile,
order blocks + FVG, 34 chandeliers, H&S, doubles, wedges [artefact de
résolution démasqué], Fibonacci, sweep&reclaim, squeeze, MACD/stoch/RSI/
supertrend/ADX/divergences) avec UN survivant : **Donchian×volume → btc-swing**.
Ce qui n'a JAMAIS été fait ici et que ce chantier livre :

1. **Constructions FIDÈLES à la pratique chartiste** (port de
   trader-pro-max-ultra/research/patterns2/detect2.py, prouvé par placebo
   0,9 % + contrôle positif là-bas) : neckline INCLINÉE par les 2 creux,
   tendance préalable exigée, proéminence de tête, Fib ANCRÉ jambe
   pivot→pivot (jamais glissant), S/R niveaux multi-touches, OB avec BOS.
   Pivots = `fractalPivots` maison (causalité prouvée par test de troncature).
2. **Compléter le catalogue manquant** : cup & handle (+inverse), rounding
   top/bottom, wedges REFAITS (multi-résolution k, la leçon G4), flags &
   pennants (mât + consolidation — à peine effleurés), triangles
   ascendant/descendant/symétrique (≥3 touches), canaux, triples
   sommets/creux, divergences prix/oscillateur formalisées.
3. **Score de qualité chartiste + DOSE-RÉPONSE** (le test qui tranche
   « mal placé vs sans valeur ») : noter chaque instance (tendance préalable,
   symétrie, rondeur fit quadratique, profondeur/durée canoniques, netteté
   des touches, anse moitié haute, profil de VOLUME — réel en crypto :
   décroissant dans la formation, pic à la cassure —, proximité niveau
   majeur). Si haute qualité ne surperforme pas médiocre + tout-venant → pas
   de contenu, définitivement.
4. **Multi-timeframe 1h/4h/1d** (intestable côté actions, gratuit ici) ×
   BTC, ETH, panier d'alts liquides (USDT). BH-FDR à la mesure de la grille.
5. **Évaluation double** : event study (fwd, null rotation) ET trade canonique
   du manuel (entrée cassure à l'open+1, stop/objectif mouvement mesuré,
   frais réels, priorité stop conservatrice) — les deux.
6. **Galerie SVG par famille** (modèle render_gallery.py : ancres exactes,
   necklines, zones, stops/objectifs, échantillons haute ET basse qualité),
   publiée en artifact pour audit visuel par Mario.
7. **Indicateurs classiques en système complet** : standalone PUIS confluence
   (synergie par permutation — leçon confluence1 actions : la confluence
   CONCENTRE un edge vivant, elle n'en crée pas), avec coûts.

Statut : ⛔ **RÉFUTÉ, définitif (2026-07-15, 4 passes + auto-audit visuel** —
`patterns-crypto/LOG.md`). Aucune famille ne franchit la chaîne (le seul
dose-réponse ✓ était un artefact d'apex démasqué à l'ŒIL ; 6 familles
ANTI-dose-réponse — la « qualité » du manuel fait pire) ; confluence 0/42.
Le réel résiduel = cassures de momentum/base à médianes fortes = l'edge
breakout maison (btc-swing) déguisé. OOS de CUP/ROUND/PENN préservé
(rejugeables sur données vierges FUTURES uniquement). Leçon de méthode
gravée : audit visuel par captures OBLIGATOIRE pour tout détecteur
géométrique.

## Les horizons (mécanisme / données / prior / statut)

Priors : maison (campagnes passées listées) × littérature. Statuts :
🕳 vierge · 🔬 en cours · ⛔ réfuté (LOG) · ✅ validé · ⏸ parqué (données/coût).

| # | Horizon | Mécanisme économique | Données | Prior | Statut |
|---|---|---|---|---|---|
| H1 | **Cross-section altcoins USDT** (50-200 alts) : momentum, réversion, low-vol, long-only ET long/short | dispersion énorme, retail non arbitré, cycles de rotation sectorielle | klines alts USDT 1h/4h/1d à télécharger (Vision, gratuit) ; univers avec délistées (489 \*/BTC déjà en base → refaire en \*USDT, survivorship-safe) | littérature forte pré-2021, décay après ; maison : rotation \*/BTC ⛔ (accum3 −100 %), satellite ⛔ (accum5, 2 looks), carry-rotation ⛔ (carry1 R1) — mais la coupe USD long/short est VIERGE | 🕳 (angle USD L/S) |
| H2 | **Carry & structure à terme** : basis spot/perp/futures datés, funding momentum, conditionnement régime | cash-and-carry = prime de levier payée par les longs ; persistance mesurée du funding | perp_funding 791 perps (à re-fetch, script carry2 prêt) ; basis datés = API OKX/Binance à construire | maison : hold BTC+ETH ✅ (carry1/2, +9,9/+11,8 %/an, en ATTENTE de décompression) ; venues R3 mesuré ; timing R4 ⛔ (hold invaincu ×3) ; basis datés & funding-momentum JAMAIS testés | 🔬 partiel ; **basis1 datés ⛔ (2026-07-16) : 6/6 cellules ×3-5 sous le perp hold (+1,4…+3,9 %/an vs +9,9/+11,8), basis comprimée comme le funding** | ⛔ H2 ENTIÈREMENT CLOS |
| H3 | **Saisonnalités intraday 24/7** : heure, jour de semaine, fenêtres de funding 00/08/16 UTC, sessions US/Asie | flux mécaniques datés (funding, expirations, opens TradFi) + retail asiatique | 1h BTC/ETH spot+perp en base | **saison1 ⛔ CLOS (2026-07-16)** : 4 familles, 0 survivant BH ; machinerie prouvée (placebo 0/62 + contrôle positif basis↔funding +0,82) ; F2 weekend effect mort ; F3 le règlement ne fuit pas dans les rendements horaires ; taker exclu par ordre de grandeur (≤6 bps/h vs 60 bps/cycle) ; angle maker noté ; OOS intact | ⛔ (maker noté) |
| H4 | **Chantier chartiste complet** (section dédiée ci-dessus) | — | 1h/4h/1d multi-actifs | maison : folklore ⛔ sauf Donchian ✅ ; dose-réponse JAMAIS faite | 🔬 prioritaire |
| H5 | **Lead-lag** : BTC→alts, gros→petits, spot→perp | information incorporée d'abord sur l'actif liquide | klines alts multi-TF (cf. H1) + perp vs spot BTC (déjà là) | littérature : réel à minutes-heures, fragile après frais ; maison : vierge | 🕳 |
| H6 | **Flux mécaniques** : cascades de liquidations, purges d'OI, réversion post-flux forcé | le flux FORCÉ (pas le sentiment) déplace le prix au-delà de l'équilibre | Coinalyze agrégé (fenêtres 4h/1h glissantes — pertes possibles selon décision PG) ; binance_metrics 5min re-téléchargeable ; tick liquidations = Tardis ~3 k$/mois ⏸ | maison : accum6 ⛔ aux DEUX grains (cascade continue, squeeze=momentum, ΔOI mort, ls_z réel mais non tradable) | ⛔ sauf grain tick ⏸ |
| H7 | **Vol & régimes + le côté SHORT** : vol-targeting perps, régimes de dominance, stratégies SHORT dédiées | vol clusterisée ; TOUT l'historique maison est long-only — la moitié de l'espace est vierge ; un short perp en bear TOUCHE le funding | funding + klines déjà là ; futures OK + 447 perps 1d en base | **regime1 = PREMIER SURVIVANT CHAÎNE 1-8** (2026-07-16) : G2,5/C3 short quintile funding-max + long BTC, porté par porte médiane-funding ≥ 2,5 bps/j — OOS spot +1,77 / perps réels +1,62 / univers OKX +1,39 ; duel solo perdu (DD) mais **contribution sleeve 20 % : composite OOS Sharpe 0,66→1,30, ρ≈0** ; fiche = regime1/PROPOSITION.md, décision Mario en attente | ✅ **survivant → fiche à Mario** |
| H8 | **Stat-arb / pairs entre alts corrélés** | co-intégration sectorielle (L1s, DeFi, memes) | 1d univers + 1h univers en base | **pairs1 ⛔ CLOS SANS RÉEL (2026-07-16)** : contrôle planté jamais passé (3 designs, 2 forces) — t_max d'une vraie co-intégration hl 10 j sur 180 j ≈ 2,5 < seuil EG 3,4 (indép. du bruit) → sélection non-certifiable, top-k dominé par spurious DF ; hl≤5 j certifiables = cycles courts tués par 1,2 %/cycle taker ; IS/OOS vierges par construction ; maker/1h hors périmètre noté | ⛔ (puissance × coûts) |
| H9 | **Événementiel** : listings/délistings, halvings, unlocks, inclusions | flux d'offre/demande datés et publics | dates dérivées des candles Vision + listTime OKX ; unlocks = source externe ; halvings n=4 | **listing1+2 ✅ CANDIDAT N°2 (2026-07-16)** : drift −22 %/30 j IS (5/5 années) → OOS −26 %, tradabilité 93 % ; STRATÉGIE en chemin validée barre complète (S2 K30 stop : mécanique 1,31/2,16, ×2-coûts+cap 1,28/2,10, tradable Sharpe 2,9, win 71 %) ; marge ISOLÉE obligatoire (8 % liquidations) ; OKX : 55 % couverts, délai méd +0,5 j → re-mesure entrée-OKX = NEXT ; halvings/unlocks vierges | ✅ candidat n°2 (démo parquée) ; **restes H9 (2026-07-17)** : halvings = n=2 dans nos données (2020 : +36/+73 % à 90/180 j ; 2024 : +2,6/+3,8 %) — descriptif, AUCUNE inférence possible, folklore non testable ; unlocks ⏸ sources historiques payantes (DefiLlama emissions passé payant) | ✅ candidat n°2 (démo parquée) ; halvings n=2 ; unlocks ⏸ |
| H10 | **On-chain / sentiment** | métriques d'adoption/spéculation | sources externes (Coinmetrics community, F&G…) | maison : 0/8 (aggflow CVD ⛔, sentiment jamais survivant) ; actions : F&G mort en OOS | **onchain1 ⛔ CLOS (2026-07-16)** : 0/6 BH — F&G néant p=0,27 (signe momentum, pas contrarian), AdrActCnt p=0,044 seul = tué par multiplicité, TxVal indisponible en gratuit ; maison 0/8→0/11 ; OOS intact | ⛔ |
| H11 | **Microstructure aggTrades intraday** (CVD stratifié, absorption, imbalance 1-15m) | l'empreinte des gros ordres précède le mouvement court | infra aggTradeStore prête, 0 fichier local (re-DL Vision, volumineux mais gratuit) | maison : aggflow ⛔ sur la thèse linéaire (baleine n'ajoute rien au takerFlow candle) — grains plus fins vierges | 🕳 (grain fin) ; **⛔-par-coûts (2026-07-17, arsenal §8 « frais d'abord »)** : au grain 1-15m la prédictibilité structurelle (2-5 bps) est 12-30× sous les 60 bps/cycle taker — verdict arithmétique, grains supérieurs du même mécanisme déjà ⛔ empiriquement (aggflow, accum6) ; angle TIMING D'EXÉCUTION noté pour la démo PortfolioRunner | ⛔ par coûts (exéc. noté) |
| H12 | **Cross-venue prix** : Binance vs OKX/Bybit (lead-lag, bases locales) | fragmentation ; le prix « vrai » émerge sur la venue dominante | funding OKX 40 perps (Coinalyze, venue1/funding_okx.csv) + closes OKX API | **venue1 (2026-07-16)** : V2 lead-lag ⛔ (corr même-jour ~1,000, t+1 = bruit ±0,08, Δclose 4 bps << 60 bps) ; V1 = LIVRABLE fiches candidats : funding OKX↔Binance écart ~0 bps/j sur le junk, ratio porte-ON 0,88, corr fine 0,57 (sans gravité, cf. 8c) ; Bybit/grains fins sans objet taker | ⛔ recherche / ✅ service fiches |
| H13 | **Vol implicite / DVOL Deribit** : prime de risque de vol, signaux IV vs RV | vendeurs de protection surpayés en régime calme | API Deribit publique (DVOL 2021→) à brancher | littérature options riche ; maison vierge ; exécution options = hors périmètre bots actuels (signal only) | **signal1 ⛔ CLOS (2026-07-16)** : DVOL-niveau dégénéré (tendance baissière structurelle vide Q5 en rang expansif) ; VRP néant (p=0,25, n=69 — sous-puissance pré-consignée) ; cache dvol_btc.csv 1940 j ; OOS intact | ⛔ |
| H14 | **Méta-portefeuille des moteurs maison** : sizing/vol-target/corrélation entre accum, vrx, swing (+ candidats) | la diversification des MÉCANISMES est le seul free lunch local | equity curves moteur réel (regime1/ + meta1/) | **meta1 ✅ FORMALISÉ (2026-07-16)** : moteurs actuels = bloc bêta (accum↔vrx +0,91, eth +0,76) ; regime1 seule brique ρ≈0 ; sleeve améliore 3 règles × tous poids {5-30 %} incl. bear 2022 ; R-IVOL WF > R-EQ en profil OOS (Calmar 0,81 vs 0,34) ; portefeuille réel actuel = pire profil (DD 58 %) ; vol-target global non exploré | ✅ formalisé (outil de décision) |

**Ordre d'attaque proposé** (prior × faisabilité données, révisable chaque
session) : audit1 ✅ → H4 ⛔ → H1 ⛔ → H2-coupe ⛔ → H7 ✅ (regime1
survivant, fiche à Mario) → **suite : H14 (méta-portefeuille, le « 1er
candidat » existe désormais) et/ou H3 (saisonnalités, vierge) et/ou
H2-basis-datés** → H5/H8 → H11/H12 → H9/H13 → H10.

## Règles de session (reprise)

1. Relire ce fichier + le LOG de la campagne en cours ; reprendre là où ça
   s'est arrêté ; mettre à jour les statuts en fin de session ; commit local
   fréquent (jamais de push sans GO).
2. Chaque campagne = son dossier `research/<nom>/` avec LOG.md pré-enregistré.
3. Tout chiffre publié à Mario : net de frais, avec fenêtre, avec null, avec
   position vs bande placebo.
4. Incident machine connu : disque plein → Docker/PG tombent. Vérifier
   `df -h` en début de session. Base de recherche : port **5438**
   (tpx-research-db) tant que la décision sur la base 5436 n'est pas prise.

## ROADMAP v2 — EXTENSION DE LA CARTE (2026-07-17, sur directive Mario « étends la carte »)

La carte initiale (14 horizons) est intégralement traitée : 2 candidats
validés (H7 regime1, H9 listing2), 10 réfutations hermétiques, le reste
formalisé/parqué. Extension par priors × faisabilité × non-redondance :

| # | Piste | Mécanisme | Données | Prior | Statut |
|---|---|---|---|---|---|
| N1 | **regime2 « capitulation »** — le MIROIR de regime1 : porte funding médian ≤ −G, long le quintile funding-min (les plus shortés) ± hedge | squeeze/rebond post-capitulation ; accum6 avait noté « ls_z contrarian = seule trace réelle » ; les shorts crowded paient le rebond | 100 % en place (panel funding + perps) | moyen-fort | 🔬 attaqué | ⛔ (n structurel + carry connu ; 5e attrape placebo) |
| N2 | **Facteur VOLUME cross-section** — z-score de volume anormal → forward (pump detection L/S) | le volume anormal du junk précède/accompagne les dumps | quote_volume univers 1d en base | moyen | 🕳 | ⛔ critère 4 (réel 5/5 années mais ×2→0,18 ; OOS préservé) |
| N3 | **Réplication Bybit de regime1** — le candidat n°1 doit exister sur une venue indépendante | validation externe (pas un nouvel edge) ; funding Bybit = le plus riche (R3) | archive publique Bybit à construire | renforce la fiche | 🕳 | ✓ CONFIRMÉ (OOS +1,42 = 88 % du candidat, signal 100 % Bybit) |
| N4 | **Flux de listings Bybit/OKX pour listing2** — élargit le n et la capacité du candidat n°2 | même drift, autres venues d'événements | listTime OKX ✓ ; archive Bybit | renforce la fiche | 🕳 |
| N5 | Timing d'exécution 15m-1h des ordres candidats | réduction de slippage | 1h univers en base | utilité démo | ⏸ à la démo |

Ordre d'attaque : N1 → N2 → N3/N4 (renforcement des fiches). Arsenal
inchangé (protocole committé avant, placebo, contrôle, BH, OOS une passe,
barre inamovible).
