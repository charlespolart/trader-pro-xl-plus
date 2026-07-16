# venue1 — cross-venue OKX vs Binance (H12, protocole pré-enregistré)

**Ouvert le 2026-07-16, committé AVANT toute exécution.** Double objectif :
(1) H12 recherche (lead-lag/bases inter-venues) ; (2) SERVICE AUX DEUX
CANDIDATS PARQUÉS : quantifier le risque de base « signal calculé sur
données Binance, exécution OKX » — la principale inconnue des fiches
regime1 et listing2.

## Données

- Funding OKX quotidien : API Coinalyze (funding-rate daily, profondeur
  2020→, venue `.3`), clé apps/backend/.env — 1 req/symbole, throttle.
- Funding Binance : déjà en base (perp_funding 5436 / funding_daily_all).
- Prix OKX 1d : API OKX market/history-candles (paginée) — 10 symboles
  témoins pour V2.

## V1 (prioritaire) — risque de base funding OKX/Binance

Échantillon FIGÉ : les 40 perps les plus fréquents du quintile shorté
regime1 en OOS 2024-26 ∩ listés OKX (+ BTC/ETH témoins). Fenêtre
2024-01→2026-07, quotidien. Mesures :
1. corrélation par symbole du funding quotidien OKX vs Binance (méd, p10) ;
2. écart moyen (Binance − OKX) en bps/j (le « R3 » de carry1 disait
   OKX paie 1-3 pts de MOINS — re-mesure sur NOTRE échantillon junk) ;
3. **LA mesure regime1** : les jours où la porte Binance est ON
   (médiane ≥ 2,5 bps/j), ratio du funding OKX encaissé vs Binance sur les
   noms shortés — « OKX paie-t-il aussi pendant les manies ? ».
Barre indicative (pas une survie — un DIAGNOSTIC pour les fiches) :
corr méd ≥ 0,6 ET ratio jours-ON ≥ 0,6 → risque de base gérable ;
sinon RED FLAG consigné dans les deux fiches (mitigation : porte
re-calculée sur funding OKX en démo).

## V2 (réfutation rapide) — lead-lag prix inter-venues au grain tradable

10 symboles témoins (majors + junk), closes 1d OKX vs Binance, 2 ans :
corr(r_1d) attendue > 0,99 et |Δclose| médian << coûts → aucun lead-lag
exploitable au grain qu'on sait trader ; verdict en une mesure. (Le
lead-lag milliseconde des MM est hors périmètre par construction.)

## Journal

- 2026-07-16 : protocole écrit et committé avant exécution.
- 2026-07-16 : bug d'unités attrapé par vérification factuelle (Coinalyze
  renvoie des POURCENTS, Binance des fractions — premiers chiffres
  aberrants ratio 88×, corrigé à la lecture, vérifié sur WLD vs API OKX).

## VERDICT (2026-07-16) — V1 nuancé (les mesures P&L sont bonnes), V2 ⛔ net

**V1 — risque de base funding OKX/Binance (40 perps junk du quintile
regime1 OOS, méd 912 j communs, 2024-26)** :
- écart de niveau (Binance − OKX) : **méd +0,03 bps/j, moy −0,46 bps/j** —
  quasi nul sur NOTRE junk (le « OKX paie 1-3 pts de moins » de carry1
  valait pour les majors, pas ici) ;
- **ratio jours porte-ON : 0,88** — quand la porte Binance dit manie
  (moy +2,91 bps/j), OKX paie +2,57 bps/j : l'encaissement en manie est là ;
- corrélation quotidienne fine : méd +0,57 (p10 +0,22) — le jour-à-jour
  diverge (clamps/timing 4h-8h par venue).
**Barre diagnostique à la lettre : RED FLAG (corr 0,57 < 0,6 de justesse) —
lecture honnête consignée** : les deux mesures qui gouvernent le P&L réel
(écart ~0, ratio ON 0,88) sont BONNES ; la corr fine basse n'affecte que la
sélection jour-à-jour, dont on SAIT (regime1 étape 8c, p=0,26) qu'elle
n'est pas la source de l'edge dans l'univers OKX. Impact fiche regime1 :
risque de base GÉRABLE, mitigation inchangée (re-mesurer la porte sur
funding OKX en démo). Chiffres reportés dans PROPOSITION.md.

**V2 — lead-lag prix inter-venues (10 symboles, 2024-07→2026-07, 1d)** :
corr même jour +0,998…+1,000 ; corr Binance→OKX t+1 : bruit pur
(−0,08…+0,08) ; |Δclose| méd 0,5-12,5 bps (méd globale 4,4) vs 60 bps de
coûts → **⛔ aucun lead-lag inter-venue exploitable au grain tradable** ;
collatéral positif : prix d'exécution OKX ≈ Binance au 1d (les backtests
des 2 candidats transposent côté PRIX — cohérent étapes 6/8c et listing2).

ROADMAP : H12 traité — V2 ⛔ (recherche), V1 = livrable de service aux
fiches (pas un edge). Le reste de H12 (Bybit, grains fins) : sans objet
pour nos bots taker, non poursuivi.
