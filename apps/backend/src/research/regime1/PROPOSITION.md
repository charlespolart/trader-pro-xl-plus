# PROPOSITION — sleeve « short-junk régimé » (regime1 G2,5/C3)

**Statut : recherche terminée, chaîne 1-8 complète. AUCUNE action live sans
GO explicite (Phase 0). Ce document est la fiche de décision pour Mario.**

## En une phrase

Quand le marché entre en manie (funding médian des perps ≥ 2,5 bps/jour),
shorter le panier de junk au funding le plus extrême et détenir du BTC long
1:1 en face ; rester totalement à plat le reste du temps.

## La règle exacte (prête à spécifier)

- **Porte** : médiane du funding QUOTIDIEN des perps éligibles ≥ 2,5 bps/j
  (éligible = ≥ 21 événements de funding OBSERVÉS, dernier < 48 h). Évaluée
  au rebalancement. ON ≈ 69 % du temps en 2020-23, ≈ 50 % en 2024-26.
- **Quand ON** : short équipondéré du quintile funding-max (signal FLEVEL
  L3 : funding cumulé 3 j) parmi les éligibles shortables ; long BTC même
  notionnel (en pratique : le BTC spot déjà détenu peut servir de jambe
  longue — c'est même MEILLEUR, cf. étape 6). Rebalancement K = 7 jours.
- **Quand OFF** : zéro position, zéro coût.
- Coûts modélisés : 30 bps/côté sur le notionnel tourné + funding réel
  (reçu par les shorts, payé par le long BTC si perp).

## Les chiffres (chaîne complète, committée dans LOG.md)

| Étape | Mesure | Résultat |
|---|---|---|
| 1-4 IS 2020-07→2024-01 | net, placebo 0/9, BH, coûts ×2 | Sharpe +1,15, Calmar 2,12, ép 6/10, ×2 → 0,82 ✓ |
| 5 OOS 2024-01→2026-07 (une passe) | proxy spot | **Sharpe +1,77 (154 % de l'IS), +122,7 %/an, DD 33,4 %, ép 7/11, Bonferroni ×2 ✓** |
| 6 vrais prix perps | exécution perp intégrale | OOS **+1,62**, +103,4 %/an ; ~toute la dégradation = funding payé par le long BTC perp → long spot ≈ chiffres spot |
| 7b duel solo USD vs btc-swing | brut | PERDU (CAGR ×2,7 mais DD 45 % vs 24 % — pas « à risque comparable ») |
| 7c contribution portefeuille | sleeve 20 %, vol égalisée | **OOS : Sharpe composite 0,66 → 1,30, CAGR +17,9 → +45,4 %/an, DD moindre** ; corrélations ≈ 0,00 |
| 7d stabilité | 7 périodes calendaires | 7/7 positives (pire : 2021, +0,18) |
| 8a capacité | participation 1 % | p10 des paniers = 651 k$ (sleeve 6 k$ → marge ×100) |
| 8c exécutabilité OKX | re-mesure OOS univers OKX | **Sharpe +1,39 (86 % de la réf), +89,9 %/an** — déployable univers réduit |

**Par la définition committée de la cible (ROADMAP « rapporte plus » = duel
OU contribution), la barre de la mission est ATTEINTE via la contribution.**

## Positionnement honnête

Ce n'est PAS un remplaçant d'un bot existant : en solo il rapporte ~3× le
swing mais avec ~1,8× son DD. C'est une **sleeve décorrélée** (ρ ≈ 0,00 vs
les 3 moteurs) qui, ajoutée à 20 % à risque total constant, améliore
fortement le composite (OOS : Calmar 0,57 → 1,50). Sa valeur vient de la
PORTE (dormant hors manie) + l'exposition short-junk + long BTC.

Complément meta1 (H14, LOG committé) : tes moteurs actuels corrèlent entre
eux à +0,73…+0,91 (un bloc bêta BTC/ETH) — regime1 est la SEULE brique à
ρ≈0 du système ; la courbe complète poids→profil {5,10,20,30 %} montre une
amélioration à TOUS les poids (mécanique vu ρ=0 — voir caveats meta1/LOG),
y compris pendant le bear 2022 (−19,3 %→−13,0 % à w=20). 20 % reste la
recommandation ; 10 % est déjà substantiel si tu préfères démarrer petit.

## Limites et risques (tous consignés dans LOG.md)

1. **Univers OKX réduit** : 26-34 % de couverture du panier théorique →
   on déploie la version « univers OKX » (+1,39 OOS, non +1,62). Dans ce
   sous-univers la sélection fine n'est plus significative (p=0,26) : la
   porte fait l'edge, pas le tri intra-panier.
2. **Funding OKX ≠ Binance — MESURÉ (venue1, 2026-07-16)** : sur les 40
   perps junk du quintile OOS, écart de niveau quasi nul (méd +0,03 bps/j)
   et **ratio 0,88 les jours porte-ON** (OKX paie aussi en manie) ;
   corrélation jour-à-jour fine +0,57 seulement — sans gravité car la
   sélection fine n'est pas la source de l'edge OKX (étape 8c). Risque de
   base GÉRABLE ; mitigation inchangée : re-mesurer la porte sur funding
   OKX pendant la démo.
3. **DD intrinsèque 33-45 %** de la sleeve seule ; épisodes perdants réels
   (4/11 en OOS). Le sizing 20 % est ce qui rend ça portable.
4. Concentration BTC : pendant ON, le swing est long BTC 35,6 % du temps en
   même temps que notre jambe longue — exposition BTC cumulée à surveiller.
5. Le backtest rebalance au close 1d ; l'exécution réelle (ordres, minima,
   marge cross) fera l'objet du bot démo. Levier compte ≈ 2× la sleeve
   quand ON (ou 1× si la jambe longue = BTC spot déjà détenu).
6. Améliorations FUTURES identifiées, non testées (pas de dérive) : mapping
   1000×↔spot (élargit le junk shortable), filtre ADV, jambe longue spot.

## Plan proposé (rien ne démarre sans ton GO)

1. **Spécifier la stratégie TS** (`strategies/`) : multi-symbole perps OKX,
   porte sur funding Binance (data), K7, sleeve paramétrable — chantier
   moteur : premier bot MULTI-SYMBOLE de la plateforme. **CHIFFRÉ le
   17-07 : voir `research/moteur-multi/ETUDE.md`** — PortfolioRunner dédié
   (zéro risque pour les bots live), ~15-24 j de dev pour les DEUX
   candidats (listing2 partage 70 % de l'infra), plan A/B/C, risques et
   parades. La démo des deux candidats est donc un SEUL chantier.
2. **Bot DÉMO OKX** avec les gardes habituelles (pré-trade soldes réels,
   dérive bloquante, Telegram par transaction), sleeve simulée ~6 k$.
   Validation : ≥ 1 épisode ON complet propre + funding OKX mesuré vs
   Binance.
3. Revue ensemble → décision réel (sleeve 20 % max, jamais plus sans
   nouvelle discussion).

## Ce que je te demande

- **GO / NO-GO / questions** sur le principe de la sleeve regime1.
- Si GO : je chiffre d'abord le chantier multi-symbole (étude moteur, pas
  de code live), puis on lance le bot démo.
- Si tu préfères : je continue la ROADMAP (H3 saisonnalités, H2-basis) et
  cette fiche attend — le facteur est épisodique, il ne « périme » pas vite.

## Post-scriptum robustesse (venue2, 2026-07-17)

Le signal reconstruit à 100 % sur le funding BYBIT (venue indépendante, via
Coinalyze) reproduit l'OOS : Sharpe +1,42 (88 % du candidat), +70,4 %/an,
ép 3/4. Le facteur n'est pas un artefact de données Binance. Option de
design pour la démo : porte multi-venue (plus robuste aux pannes de
source).
