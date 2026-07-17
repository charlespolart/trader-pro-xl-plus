# PortfolioRunner — Phase A (construite, non branchée)

Exécuteur multi-symbole quotidien des deux candidats validés (regime1,
listing2). **Rien n'est branché au runtime live** : pas d'import depuis
index.ts, pas de démarrage automatique, mode LIVE volontairement absent.

## Modules
- `targets.ts` — cibles du jour (regime1 + listing2), parité BIT-IDENTIQUE
  avec le backtest (check_targets : 313/313 rebalancements).
- `dataFeed.ts` — données quotidiennes : candles via candleStore (Vision),
  funding via table agrégée + Coinalyze pour les jours pré-archivage
  (pseudo-événements 12:00 UTC purgés par reconcileFunding).
- `okxPortfolioAdapter.ts` — plan de rebalancement pur (diff cibles ↔
  positions, sizing en contrats réels, skip hors-OKX compté) ; exécution
  DRY par défaut, LIVE non implémenté (Phase B).
- `portfolioRunner.ts` — le tick : gardes (fraîcheur 36 h, kill switch
  `portfolio.KILL`, plafond brut 2,2×), grille K7 ancrée persistée, paper
  (mark aux closes + funding réels, coûts 30 bps), état JSON.
- `tick.ts` — entrée CLI (`bun tick.ts [table|csv] [dry]`).
- `tick_dry.ts` — inspection ponctuelle (`fresh` = funding Coinalyze du
  jour ; `date=YYYY-MM-DD` = rejouer une décision historique).
- `check_targets.ts` — test croisé runner ↔ backtest.

## Vérifié
- Parité cibles 313/313 ; backtests TS = python (run.ts tout vert).
- Garde de fraîcheur (données périmées ⇒ abstention) ; chemin paper complet.
- Plan d'ordres réel sur jour porte-ON historique (contrats/lots/minSz OKX,
  skips comptés).

## Reste pour la Phase B (marche à blanc)
1. Cron externe du tick nocturne (host/VPS) + Telegram branché.
2. `compareFundingSources` sur un mois plein (barre ≈ 0 divergence).
3. listing2 dans le runner (la couche cibles existe déjà — câbler slots).
4. Sous-compte OKX (à créer par Mario) + clés lecture seule pour le
   reconcile réel ; l'envoi d'ordres (LIVE) n'arrive qu'en Phase C avec GO.
