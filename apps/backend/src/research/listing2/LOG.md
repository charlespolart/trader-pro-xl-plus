# listing2 — stratégie « short-new-listings » EN CHEMIN quotidien (protocole pré-enregistré)

**Ouvert le 2026-07-16, committé AVANT toute exécution ET avant d'avoir
regardé le moindre chemin quotidien** (listing1 n'a exposé que des points à
7/30/60 j — les choix ci-dessous sont donc pré-déclarés à l'aveugle du path).

## Point d'honnêteté sur l'OOS (consigné d'avance)

L'OOS 2024-26 du SIGNAL a été dépensé par listing1 (drift −26 % connu). La
passe stratégie sur 2024-26 est donc une passe d'IMPLÉMENTATION (le chemin,
les stops, le funding path, les liquidations sont encore vierges), PAS une
re-validation du signal. La validation finale de la stratégie = bot démo en
marche avant (comme regime1). Aucune cellule ne sera « re-choisie » sur
2024-26 au-delà de la grille figée ci-dessous.

## Définition (FIGÉE)

- **Événement** : listing spot Binance (1re bougie 1d) dont le perp devient
  actif ≤ J+7 (1er jour de funding observé) ; **entrée = close du 1er jour
  de funding observé**.
- **Constructions (2, figées)** : S1 short nu 1× ; S2 short + long BTC 1:1
  (architecture C3 — capture l'excès).
- **Détention K ∈ {7, 14, 30} j** depuis l'entrée, sortie au close.
- **Stops (2 variantes figées)** : sans stop ; stop au close quotidien si
  le prix a monté de ≥ +50 % depuis l'entrée (évalué au close — pas
  d'intrabar ; le risque de mèche/liquidation intra-jour est traité par le
  stress ci-dessous, pas caché).
- **Portefeuille** : 1 unité de capital par événement, max M=10 événements
  ouverts simultanément (FIFO au-delà — figé), pnl agrégé quotidien.
- **Coûts** : 30 bps/côté + funding quotidien réel payé/reçu
  (funding_daily_all). Stress coûts ×2.
- Grille totale : 2 constructions × 3 K × 2 stops = 12 cellules, BH-FDR 10 %.

## Éval & garde-fous

- Fenêtres : 2019-02→2024-01 (mécanique, n≈65 tradables — consigné : l'ère
  pré-2024 sous-échantillonne la tradabilité) et 2024-01→2026-07 (l'ère
  tradable, passe d'implémentation) — rapportées SÉPARÉMENT.
- **Null** : même machinerie sur pseudo-événements (mêmes dates, actifs
  aléatoires vivants appariés — le null validé de listing1), 1000 tirages →
  percentile ≥ 95 du Sharpe portefeuille.
- **Placebo** : grille complète sur pseudo-événements → ~1 % à p<0,01.
- **Contrôle de cohérence** : S1 K30 sans stop doit retrouver ~le drift
  event study par événement (méd ≈ −20/−28 % selon l'ère), sinon bug.
- **Stress de chemin OBLIGATOIRE** : distribution du PIRE excursion
  intra-trade par événement (max adverse au close) ; part des événements
  dépassant +50/+100 % contre nous ; pnl si les trades > +100 % adverse
  sont comptés à −100 % (proxy liquidation 1×). Pire chemin documenté.
- Barre de survie : Sharpe portefeuille ≥ 0,8 ET Calmar > 1 (par ère),
  coûts ×2 → > 0,5, majorité d'événements gagnants, pire événement borné
  par le sizing (aucune cellule retenue si le proxy-liquidation inverse le
  verdict). Règle du trop-beau : tout résultat > event study → audit.

## Journal

- 2026-07-16 : protocole écrit et committé avant toute exécution.
