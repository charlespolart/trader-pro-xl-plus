# audit1 — audit des fondations (protocole pré-enregistré)

**Ouvert le 2026-07-15, AVANT toute exécution des vérifications.** Mandat de
Mario : la même passe d'audit complète que côté actions (trader-pro-max-ultra),
où 3 jours d'audits ont trouvé des bugs réels malgré une méthodo rigoureuse :
signe de dérive inversé dans les nulls directionnels (patterns1, erratum
`27b03e4` là-bas), constructions sur extrema GLISSANTS au lieu de pivots fixes
(etf6 Fibonacci), fill au close du signal au lieu de l'open J+1, état initial
désaligné entre moteurs comparés, causalité des pivots (connu à i+k seulement).

## Incident d'ouverture (2026-07-15) — consigné, PAS corrigé silencieusement

La base PG dev locale (`tpx-postgres-1`, volume `trader-pro-xl-plus_pgdata`)
est **corrompue** : `PANIC: could not locate a valid checkpoint record`
(séquelle du crash disque-plein du matin, dernier UP 06:04:48 UTC). Actions
prises, toutes NON destructives :

1. Snapshot intégral du volume corrompu → `~/pg-snapshots/tpx-pgdata-avant-resetwal-20260715.tar.gz` (334 Mo).
2. Copie restaurée dans un volume neuf `tpx-research-pgdata` (prête pour un
   `pg_resetwal` si Mario donne le GO — **décision qui lui appartient** ; seule
   perte réelle en cas d'abandon : les fenêtres glissantes Coinalyze 4h/1h
   déjà expirées côté API ; bougies/funding/metrics = re-téléchargeables).
3. Base de recherche NEUVE `tpx-research-db` (port 127.0.0.1:5438, volume
   `tpx-research-fresh`), schéma drizzle appliqué, re-téléchargement Vision
   BTC/ETH spot 1h/4h/1d (+3d/1w agrégés) 2017-08→now.
4. Alerte envoyée à Mario (notification). Les bots LIVE tournent sur le VPS et
   ne dépendent en rien de cette base locale — aucun impact production.

## Périmètre et cibles

Un seul moteur à auditer (chance structurelle) : TOUTE la recherche TS et les
bots passent par `runBacktest` de `@tpx/core`. Les études Python des campagnes
(accum2-6, dayswing) ont leurs propres conventions (event studies close→close
sans coûts — assumées comme mesures de séparation, pas des backtests).

| # | Cible | Méthode | Attendu pré-déclaré |
|---|---|---|---|
| A1 | **Indicateurs** (26 de `packages/core/src/indicators/`) | cross-check numérique contre implémentations Python indépendantes (numpy, écrites depuis les définitions sources, PAS depuis le code TS), sur bougies BTC 4h réelles ≥ 2000 barres + marche aléatoire | erreur relative max < 1e-6 par indicateur ; couvre AUSSI ceux hors reference.test.ts : psar, supertrend, vwap, rollingVwap, stochRsi, takerFlow, efficiencyRatio, atrPercentile, squeezeRatio, varianceRatio |
| A2 | **Moteur** (fills, frais, slippage, équité, base-denom) | double implémentation comptable INDÉPENDANTE en Python : rejoue (a) une stratégie LENTE (croisement EMA50/200 1d, market only) et (b) une CHURNY (Donchian-20 4h + stop ATR, avec stop intrabar), sur les mêmes bougies exportées ; compare équité finale, nb trades, frais cumulés | écart « CAGR » (rendement annualisé) < 0,05 pt et même nombre de trades ; sinon BUG et on cherche jusqu'à accord ~0,00 (standard atteint côté actions) |
| A3 | **Conventions de fill** | tests dirigés sur SimExchange : market posé à la bougie N → fill à l'open de N+1 (+slippage signé) ; stop → trigger sur le chemin intrabar heuristique + slippage ; limit → prix limite (maker) ; OCO annule le jumeau ; LIMIT_MAKER rejeté s'il croise | comportements exacts ; consigner la priorité stop/TP même-bougie (chemin vert = stop d'abord, rouge = TP d'abord) et son impact vs convention conservatrice « stop prioritaire partout » |
| A4 | **Données** (base neuve 5438) | SQL : doublons PK, trous sur grille alignée (openTime ≡ ancre mod itv), closeTime = open+itv−1, OHLC sanity (h≥max(o,c), l≤min(o,c)), volumes nuls/aberrants, bougie partielle en tête ; 3d/1w == agrégat EXACT du 1d (re-calcul indépendant) ; 4h natif Binance == agrégat du 1h (cohérence inter-TF) ; bornes de dates | 0 doublon, 0 violation OHLC/closeTime ; trous 1h uniquement aux maintenances Binance connues (listés un par un) ; 3d/1w reconstruits identiques à 100 % ; 4h vs agg(1h) : écarts listés (attendu ≈ 0) |
| A5 | **Stratégies live** (re-backtest vs baselines des en-têtes) | mêmes fenêtres, mêmes défauts : accumulator 2019-01→2026-06 (+61,9 %, DD −29,6 %, 57 tr) et 2020-08→2026-06 (+112,5 %) ; vrx IS 2018-04→2024-01 (+243,7 %, DD −29,1 %, 162 tr) et OOS 2024-01→2026-07 (+16,9 %, DD −19,7 %, 38 tr) ; swing 2019-01→2026-01 (+474,3 %, PF 1,85, 86 tr, DD −40,6 %) ; eth-accum (baselines de son en-tête) | reproduction à ±1 pt de rendement et ±2 trades (les fenêtres sont closes, les données identiques) ; TOUTE dérive au-delà = investigation + **alerte Mario immédiate** (stratégies en argent réel) |
| A6 | **Chasse ciblée aux 5 classes de bugs actions** dans le code de recherche | revue de code dirigée : (1) nulls directionnels et leur signe (robust.ts, vrx_validate.py null_run, wfswing/donchwf 200 tirages, lib.py shift_null_p) ; (2) extrema glissants utilisés comme NIVEAUX ancrés (sr.ts OK-glissant-assumé, wedges G4 = artefact déjà démasqué, fibRetrace families.ts fenêtre fixe) ; (3) fill au close (event studies close→close : les requalifier explicitement « séparation, pas backtest » partout où un chiffre a été publié) ; (4) état initial entre moteurs comparés (fractest parité v3/v2, wf* equity de départ) ; (5) causalité pivots (fractalPivots prouvé par test de troncature — vérifier ses CONSOMMATEURS : h2sweep, sr2, dayswing) | verdict par classe : trouvé/absent, avec fichier:ligne ; tout bug → erratum committé sans se défendre |
| A7 | **Signatures vs sources** | signatures des stratégies vivantes : swing = trend-following (WR ~33 %, payoff élevé, holding ~130 h) ; accumulator = WR 32 %, payoff 3,5 ; vrx = WR 51 %, payoff 2,1 (excursions) ; re-mesurées sur les re-backtests A5 | conformité aux valeurs documentées ; une signature qui change = même alarme qu'A5 |

## Garde-fous de l'audit lui-même

- La double implémentation A2 est écrite AVANT de regarder les chiffres du
  moteur sur les mêmes runs (pas de calage rétroactif).
- Les attendus ci-dessus sont figés à l'ouverture ; tout écart est consigné,
  aucun seuil n'est élargi après coup.
- Base neuve ≠ base historique : si Mario répare l'ancienne, on diffe les
  tables candles (openTime/close/volume par (symbol,interval)) pour vérifier
  que les campagnes passées tournaient sur des données identiques à Vision.

## Journal

- 2026-07-15 : ouverture. Incident PG consigné (ci-dessus). Lecture complète du
  moteur (backtest.ts, simExchange.ts, trades.ts, metrics.ts, runtime.ts,
  candleStore.ts, alignOpenTime) : conventions saines par construction —
  market → open suivant (jamais le close du signal), matching AVANT la vue
  stratégie, pivots confirmés à i+right avec test d'invariance par troncature,
  3d/1w agrégés du 1d sur grille ancrée (3d : 1970-01-02 ; 1w : lundi).
  Points relevés pour A3 : priorité stop/TP même-bougie dépend de la couleur de
  la bougie (moins conservateur que patterns2) ; ordre de livraison multi-TF
  aux frontières partagées (petit intervalle d'abord → close(0) du TF lent =
  bougie précédente, causal-conservateur, à vérifier identique en live).
  Inventaires (2 agents) : campagnes + entrepôt consignés dans la ROADMAP.
