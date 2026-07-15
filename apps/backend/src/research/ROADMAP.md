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
| H2 | **Carry & structure à terme** : basis spot/perp/futures datés, funding momentum, conditionnement régime | cash-and-carry = prime de levier payée par les longs ; persistance mesurée du funding | perp_funding 791 perps (à re-fetch, script carry2 prêt) ; basis datés = API OKX/Binance à construire | maison : hold BTC+ETH ✅ (carry1/2, +9,9/+11,8 %/an, en ATTENTE de décompression) ; venues R3 mesuré ; timing R4 ⛔ (hold invaincu ×3) ; basis datés & funding-momentum JAMAIS testés | 🔬 partiel |
| H3 | **Saisonnalités intraday 24/7** : heure, jour de semaine, fenêtres de funding 00/08/16 UTC, sessions US/Asie | flux mécaniques datés (funding, expirations, opens TradFi) + retail asiatique | 1h/4h déjà là ; grain 15m à ajouter si signal | littérature : effets documentés mais fins ; maison : session.ts = mini-étude descriptive seulement | 🕳 |
| H4 | **Chantier chartiste complet** (section dédiée ci-dessus) | — | 1h/4h/1d multi-actifs | maison : folklore ⛔ sauf Donchian ✅ ; dose-réponse JAMAIS faite | 🔬 prioritaire |
| H5 | **Lead-lag** : BTC→alts, gros→petits, spot→perp | information incorporée d'abord sur l'actif liquide | klines alts multi-TF (cf. H1) + perp vs spot BTC (déjà là) | littérature : réel à minutes-heures, fragile après frais ; maison : vierge | 🕳 |
| H6 | **Flux mécaniques** : cascades de liquidations, purges d'OI, réversion post-flux forcé | le flux FORCÉ (pas le sentiment) déplace le prix au-delà de l'équilibre | Coinalyze agrégé (fenêtres 4h/1h glissantes — pertes possibles selon décision PG) ; binance_metrics 5min re-téléchargeable ; tick liquidations = Tardis ~3 k$/mois ⏸ | maison : accum6 ⛔ aux DEUX grains (cascade continue, squeeze=momentum, ΔOI mort, ls_z réel mais non tradable) | ⛔ sauf grain tick ⏸ |
| H7 | **Vol & régimes + le côté SHORT** : vol-targeting perps, régimes de dominance, stratégies SHORT dédiées | vol clusterisée ; TOUT l'historique maison est long-only — la moitié de l'espace est vierge ; un short perp en bear TOUCHE le funding | funding + klines déjà là ; futures OK | maison : accum4 (shorts perdent dans les RANGES — mais le short de TENDANCE bear avec carry funding est vierge) ; strat2 actions : vol-target dans la bande placebo | 🕳 (short tendance+carry) |
| H8 | **Stat-arb / pairs entre alts corrélés** | co-intégration sectorielle (L1s, DeFi, memes) | klines alts USDT (cf. H1) ; frais serrés = maker requis | littérature 2017-21 riche, décay ; maison vierge | 🕳 |
| H9 | **Événementiel** : listings/délistings, halvings, unlocks, inclusions | flux d'offre/demande datés et publics | listings = historique Binance reconstructible ; unlocks = source externe à trouver ; halvings n=4 | n faible partout ; prior faible-moyen | 🕳 |
| H10 | **On-chain / sentiment** | métriques d'adoption/spéculation | sources externes (Coinmetrics community, F&G…) | maison : 0/8 (aggflow CVD ⛔, sentiment jamais survivant) ; actions : F&G mort en OOS | 🕳 (réfutation rapide) |
| H11 | **Microstructure aggTrades intraday** (CVD stratifié, absorption, imbalance 1-15m) | l'empreinte des gros ordres précède le mouvement court | infra aggTradeStore prête, 0 fichier local (re-DL Vision, volumineux mais gratuit) | maison : aggflow ⛔ sur la thèse linéaire (baleine n'ajoute rien au takerFlow candle) — grains plus fins vierges | 🕳 (grain fin) |
| H12 | **Cross-venue prix** : Binance vs OKX/Bybit/Coinbase (lead-lag, bases locales) | fragmentation ; le prix « vrai » émerge sur la venue dominante | bougies OKX/Bybit à construire (APIs publiques, Bybit archive gratuite) | maison vierge ; à coupler avec H2-R3 (venues 1-3 pts) | 🕳 |
| H13 | **Vol implicite / DVOL Deribit** : prime de risque de vol, signaux IV vs RV | vendeurs de protection surpayés en régime calme | API Deribit publique (DVOL 2021→) à brancher | littérature options riche ; maison vierge ; exécution options = hors périmètre bots actuels (signal only) | 🕳 (comme SIGNAL de régime) |
| H14 | **Méta-portefeuille des moteurs maison** : sizing/vol-target/corrélation entre accum, vrx, swing (+ candidats) | la diversification des MÉCANISMES est le seul free lunch local | equity curves des backtests | duo 50/50 déjà ✅ (DD −19,5 % vs −29) ; formalisation complète jamais faite | 🔬 après 1er candidat |

**Ordre d'attaque proposé** (prior × faisabilité données, révisable chaque
session) : audit1 → H4 (chartiste, données prêtes) → H1 (téléchargement alts
USDT en parallèle) → H2 (basis/funding momentum, re-fetch funding) → H3/H5 →
H7 (short) → H8 → H11/H12 → H9/H13 → H10.

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
