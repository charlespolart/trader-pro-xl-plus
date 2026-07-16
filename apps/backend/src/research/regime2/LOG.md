# regime2 — LONG de capitulation régime-gated, le MIROIR de regime1 (N1, protocole pré-enregistré)

**Ouvert le 2026-07-17, committé AVANT toute exécution.** Thèse : le miroir
exact de regime1 — quand le funding médian des perps éligibles devient
PROFONDÉMENT NÉGATIF (capitulation : les shorts paient cher, crowding
baissier), le junk le plus shorté (funding le plus négatif) rebondit
(squeeze). Indices maison : accum6 « ls_z contrarian = seule trace réelle
(non tradable telle quelle) » ; carry3 : la jambe LONGUE du L/S était plate
— mais elle n'était jamais CONDITIONNÉE à la capitulation.

## Définition (FIGÉE — hérite tout de regime1, AUCUN nouveau knob)

- **Porte MIROIR** : médiane du funding QUOTIDIEN des perps éligibles
  ≤ −G, G ∈ {2,5 ; 5 ; 10} bps/j (les MÊMES seuils en négatif). Évaluée au
  rebalancement K=7 figé. Éligibilité observable identique (cnt ≥ 21,
  lastev ≤ 2, hist ≥ WARMUP).
- **Constructions (3, figées)** quand ON (sinon FLAT) :
  - D1 : LONG nu du quintile funding-min (les plus shortés) ;
  - D2 : long quintile funding-min + SHORT BTC 1:1 (hedgé — miroir de C3) ;
  - D3 : L/S inversé (long funding-min / short funding-max).
- Signal : FLEVEL L3 HÉRITÉ (même signal, l'autre queue). Coûts 30 bps/côté,
  pnl funding = −(F@w) (un long de funding négatif REÇOIT le funding ✓).
- 9 cellules (3 G × 3 D), BH-FDR 10 %.

## Garde-fous (identiques regime1)

- **Contrôle de porte** : les épisodes ON de G=5 doivent correspondre aux
  capitulations CONNUES (mai-2021, juin-2022, nov-2022/FTX, août-2024) et
  ne PAS s'activer dans les manies. Sinon stop.
- **Placebo** : prix iid par actif, funding réel → 0-1/9 à p<0,01.
- Null : réétiquetage de colonnes (le validé). Épisodes : fusion gap < 14 j,
  ≥ 3 épisodes, majorité positifs.
- Barre de survie inchangée : BH p<0,01 ; Sharpe ≥ 0,8 ET Calmar > 1 ;
  épisodes ; coûts ×2 → > 0,5 ; OOS UNIQUE 2024-01→2026-07 (même signe,
  ≥ 50 % du Sharpe IS, épisodes majoritaires). IS 2020-07→2024-01.
- Risque assumé d'avance : les capitulations sont plus RARES que les manies
  (la médiane cross-section est structurellement positive) → ON attendu
  faible, n d'épisodes potentiellement < 3 → verdict « n insuffisant »
  possible et acceptable.

## Journal

- 2026-07-17 : protocole écrit et committé avant exécution.
