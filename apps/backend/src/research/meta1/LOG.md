# meta1 — méta-portefeuille des moteurs maison (H14, protocole pré-enregistré)

**Ouvert le 2026-07-16, committé AVANT toute exécution.** Débloqué par le
premier candidat validé (regime1, chaîne 1-8, fiche PROPOSITION.md en
attente de décision Mario). H14 ROADMAP : « la diversification des
MÉCANISMES est le seul free lunch local ; formalisation complète jamais
faite ».

## Question (formalisation, PAS découverte d'edge)

Chiffrer proprement l'allocation entre les moteurs validés et la
sensibilité au poids de la sleeve regime1, pour éclairer deux décisions :
(1) le poids de sleeve de la fiche (20 % était un choix prudent figé
d'avance — donner la courbe complète) ; (2) est-ce qu'une règle d'allocation
SIMPLE et sans re-fit bat l'allocation statique ?

## Données (toutes déjà produites, moteur réel, coûts OKX)

Équités quotidiennes 2020-07→2026-07, conversion USD au close spot 1d,
rendements simples, conventions identiques à regime1/duel.py :
- btc-swing (quote USD), btc-accumulator (base BTC), btc-vrx (base BTC) —
  regime1/incumbent_*.csv ;
- **eth-accumulator (base ETH) — À PRODUIRE** (même runner, ETHUSDT,
  symbolInfo épinglé ETH) : le portefeuille réel de Mario le contient
  (3,9966 ETH) ;
- sleeve regime1 = perp intégral (regime1/regime1_perp_daily.csv).

## Règles comparées (FIGÉES d'avance — aucune n'est optimisée)

- **R-EQ** : équipondéré 1/4 (accum, vrx, eth, swing), rebalancé quotidien.
- **R-REAL** : le portefeuille réel approx de Mario — buy&hold SANS
  rebalancement des sleeves accum/vrx/eth aux poids USD du 2020-07 calculés
  depuis les tailles réelles actuelles (0,198 BTC / 0,198 BTC / 3,9966 ETH,
  normalisées en poids de départ), swing à 0 (pas de bot réel). Fidèle aux
  bots à capital séparé.
- **R-IVOL** : vol-inverse walk-forward — poids ∝ 1/vol63j, recalculés le
  1er de chaque mois sur les 63 jours PASSÉS, appliqués au mois suivant
  (zéro lookahead), rebalancé quotidien intra-mois.
- Chacune **± sleeve regime1 à w ∈ {0, 5, 10, 20, 30 %}** (grille ANNONCÉE
  d'avance ; livrer la COURBE complète, pas un point « optimal » choisi
  après coup ; 20 % reste le pré-déclaré de la fiche).
- Composites à vol égalisée vs leur propre version w=0 (levier scalaire,
  comme duel.py) pour la comparaison « à risque constant ».

## Fenêtres & sorties

Fenêtre complète 2020-07→2026-07 ; OOS 2024-01→2026-07 en second regard ;
zoom stress : 2022 (bear) et 2026-H1. Sorties : CAGR/DD/Sharpe/Calmar par
règle × poids, corrélations croisées des 5 séries, et 2-3 conclusions
robustes. PAS de barre de survie — mais honnêteté obligatoire : avec
ρ≈0, « la sleeve améliore » est quasi mécanique ; l'information est la
FORME de la courbe (où le DD remonte, comportement dans les stress).

## Journal

- 2026-07-16 : protocole écrit, committé avant exécution.
