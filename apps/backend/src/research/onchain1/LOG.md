# onchain1 — on-chain & sentiment (H10, protocole pré-enregistré)

**Ouvert le 2026-07-16, committé AVANT toute exécution.** H10 ROADMAP :
réfutation rapide attendue (maison : 0/8 historique, F&G actions mort en
OOS). Même machinerie que signal1 (quintiles expansifs, forwards, rotation).

## Signaux (FIGÉS — 3, pas d'extension sans re-commit)

- G1 : Fear & Greed crypto (alternative.me, 2018→, quotidien).
- G2 : AdrActCnt BTC (adresses actives, Coinmetrics community).
- G3 : TxTfrValAdjUSD BTC (volume on-chain ajusté, Coinmetrics community).
G2/G3 en Z-score expansif (le niveau brut trend) puis quintiles expansifs.

## Éval (identique signal1)

Cible : forward BTC 7 j / 30 j ; stat Δ(Q5−Q1) ; null rotation du vecteur
1000× (percentile bilatéral ≥ 95) ; placebo iid ; quintiles expansifs
≥ 180 j. IS 2018-08→2024-01 ; OOS 2024-01→2026-07 une passe si IS tient.
Barre d'exploitation : |ΔQ5−Q1| 30 j ≥ 120 bps, sinon « non tradable ».

## Journal

- 2026-07-16 : protocole écrit et committé avant exécution.
