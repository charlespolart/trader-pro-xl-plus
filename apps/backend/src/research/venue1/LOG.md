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
