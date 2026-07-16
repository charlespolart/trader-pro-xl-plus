# signal1 — DVOL Deribit comme signal de régime (H13, protocole pré-enregistré)

**Ouvert le 2026-07-16, committé AVANT toute exécution.** H13 ROADMAP :
vol implicite / prime de risque de vol, comme SIGNAL uniquement (l'exécution
d'options est hors périmètre bots).

## Données

DVOL BTC (et ETH si dispo même profondeur) via API publique Deribit,
résolution 1D, profondeur ~2021→. Vol réalisée RV30 = σ des log-returns
30 j × √365 (spot Binance, en base). VRP = DVOL − RV30.

## Familles (FIGÉES — 2 signaux × 1 actif, extension ETH si n suffisant)

- S1 : niveau DVOL ; S2 : VRP (DVOL − RV30).
- **Quintiles EXPANSIFS sans lookahead** : rang du jour vs tout l'historique
  PASSÉ (≥ 180 j d'historique avant de compter).
- Cible : rendement BTC forward 7 j et 30 j (close→close) — **event study
  de SÉPARATION, pas un backtest** (requalification obligatoire si signal).
- Stat : Δ(Q5 − Q1) des forwards.

## Éval & garde-fous

- Null : rotation circulaire du VECTEUR signal (leçon saison1 — ~n
  décalages), 1000 tirages, percentile bilatéral ≥ 95.
- Placebo : signal iid-shufflé → ~1 % de faux positifs attendus.
- IS 2021-06→2024-01 (DVOL commence 2021-03 + 90 j de warmup rang) ; OOS
  2024-01→2026-07 une passe si IS tient. n IS ≈ 2,6 ans : SOUS-PUISSANCE
  attendue, consignée d'avance (pooling ETH si possible).
- Barre d'exploitation : |ΔQ5−Q1| à 30 j ≥ 120 bps (2 cycles timing
  potentiels/mois × 60 bps) — sinon « info non tradable », verdict.

## Journal

- 2026-07-16 : protocole écrit et committé avant exécution.
