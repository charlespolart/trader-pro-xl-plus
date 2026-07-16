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

## VERDICT (2026-07-16) : ⛔ H13 CLOS — rien d'exploitable (placebo sain 3/100)

- **S1 DVOL niveau : dégénéré structurellement** — en rang expansif, la
  tendance BAISSIÈRE de la vol implicite depuis 2021 vide le quintile haut
  après 2022 (n5 < 30 : « n insuffisant » = un fait de structure, pas un
  bug). Le niveau de DVOL n'est pas un signal stationnaire.
- **S2 VRP (DVOL − RV30) : néant** — Δ(Q5−Q1) négatif et GROS en apparence
  (−949 bps/30 j : VRP riche → BTC sous-performe) mais p=0,25 (n Q5 = 69
  jours seulement) → indiscernable du hasard. Sous-puissance consignée
  d'avance (2,6 ans d'IS).
- DVOL reste dispo en cache (dvol_btc.csv, 1 940 j) si un jour le n
  s'allonge. OOS jamais touché.
