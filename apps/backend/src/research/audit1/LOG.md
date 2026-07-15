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

## RÉSULTATS (2026-07-15)

### A1 — Indicateurs : **41/41 PASS à la précision machine** ✅

Cross-check contre implémentations Python indépendantes (numpy, écrites depuis
les définitions sources) sur 4 380 bougies BTCUSDT 4h réelles (2022-2024).
Erreur relative max : 0 à 2,4e-9 (CCI, sommes flottantes) ; warmups conformes ;
couvre les 12 indicateurs HORS reference.test.ts (psar, supertrend, vwap,
rollingVwap, stochRsi, takerFlow, ER, atrPercentile, squeeze, VR) ; **pivots
fractals (5,5) : listes IDENTIQUES** (barIndex, kind, prix, confirmation i+5).
Un seul écart rencontré : off-by-one dans MA référence VR (premier point
légitime à agg+window−1), corrigé côté Python — le TS était juste.
Scripts : `dump_indicators.ts` + `verify_indicators.py`.

### A2 — Moteur : double implémentation accordée à **0,0000 pt de CAGR** ✅

Comptable Python indépendant (`engine_check.py`) vs moteur réel
(`engine_run.ts`), BTCUSDT spot 2019→2026-07, symbolInfo épinglé :
- sonde LENTE (golden cross 1d) : équité 88 984,27 vs 88 984,27 (Δ 0,00000 %),
  12/12 fills identiques, frais 301,58 = 301,58 ;
- sonde CHURNY (donchian 20 4h + stop 2×ATR) : 99 292,86 vs 99 292,86
  (Δ 0,00000 %), **378/378 fills identiques** (dont stops intrabar), frais
  28 892,40 = 28 892,40.
Conventions confirmées par l'accord : market → open+1 ±slippage ; stop servi au
prix de trigger sur le chemin heuristique ±slippage ; frais rognant l'actif
reçu ; arrondis floorToStep/12 chiffres.

### A3 — Conventions (notes de réalisme, pas des bugs de comptabilité)

1. **Fenêtre aveugle du stop** : un stop posé dans onFill (pattern des 3
   stratégies live) n'est actif qu'à partir de la bougie i+2 en backtest,
   alors qu'en live il est posé en secondes pendant la bougie i+1. Le backtest
   SOUS-protège la bougie d'entrée (direction conservatrice incertaine).
   Ampleur 4h : faible. À trancher par Mario si on veut la parité parfaite
   (changement moteur = hors mandat recherche).
2. **Priorité stop/TP même bougie** : chemin vert sert le stop d'abord, rouge
   le TP d'abord (heuristique standard, moins conservatrice que « stop
   toujours prioritaire »). Les stratégies live n'ont pas de TP simultané →
   sans impact produit aujourd'hui ; à retenir pour le chantier chartiste
   (trades canoniques : on adoptera stop-prioritaire).
3. **Frontières multi-TF partagées** : le petit intervalle est livré avant le
   grand au même closeTime → close(0) du TF lent = bougie PRÉCÉDENTE
   (causal-conservateur), cohérent backtest/live par construction runtime.
4. 120/120 tests du repo verts (dont sim/backtest/basedenom/pivots-troncature).

### A4 — Données (base neuve 5438, Vision pur) : **PASS** ✅

BTC/ETH spot 1h/4h/1d/3d/1w 2017-08→2026-07 (77 975 bougies 1h chacun) :
- 0 doublon ; 0 violation OHLC ; 0 prix ≤0 ; volumes cohérents (taker ≤ vol) ;
  0 bougie partielle en tête ; grilles 1d/3d/1w/4h alignées ;
- **3d et 1w == agrégat EXACT du 1d (0 écart sur 1 084 + 464 bougies ×2
  symboles)** — le correctif de juin est vérifié au niveau données ;
- artefacts de VENUE authentiques, confinés aux maintenances Binance
  documentées : 127 bougies 1h manquantes (2017-2023, halts publics), 43
  bougies 1h sur grille décalée :28:14 (redémarrage post-upgrade du
  2018-02-08→11, resynchro par bougie courte), 15 bougies écourtées par halt
  (dont 1 à durée négative 2020-12-21, telle quelle dans l'archive
  officielle) ; les 11 écarts 4h-vs-agrégat(1h) tombent tous dans la fenêtre
  décalée de 2018-02. Décision : CONSERVÉS tels quels (fidélité à l'archive).

### A5 — Stratégies live vs baselines : **décisions EXACTES, valeur ±0,3 %** ✅⚠

`accum2/baselinecheck.ts` + `dayswing/defaultscheck.ts` sur la base neuve :

| Fenêtre | attendu | obtenu | trades |
|---|---|---|---|
| accum BTC 2019→2026 | +61,9 / DD 29,6 / 57tr | +61,73 / 29,73 | **57 ✓** |
| accum BTC 2020-08→ | +112,5 / 28,0 / 49tr | +112,76 / 27,90 | **49 ✓** |
| accum BTC full 2018→ | +126,2 / 32,5 / 65tr | +125,88 / 32,67 | **65 ✓** |
| accum BTC 2024→(chop) | +4,9 | +5,10 | 18 |
| ETH IS 2018→2024 | +436 / PF 2,65 / 38tr | +437,42 / **PF 2,65 ✓** | **38 ✓** |
| ETH holdout 2024→ | +14,2 / 23,8 / 14tr | +14,40 / 23,64 | **14 ✓** |
| VRX IS 2018→2024 | +243,7 / 29,1 / 81tr | **+243,72 / 29,10** | **81 ✓** |
| VRX OOS 2024→ | +16,9 / 19,7 / 19tr | **+16,90 / 19,70** | **19 ✓** |
| swing full 2019→2026-01 | +474,3 / PF 1,85 / 86tr / DD 40,6 | +477,4 / **PF 1,85 ✓** / DD 40,7 | **86 ✓** |
| swing bear18 + holdout | 0 trade | 0 trade | **✓** |

Lecture : TOUS les nombres de trades exacts, PF exacts, VRX au centième —
**aucun signal de régression de code**. Le net dévie de ±0,2-3 pt (0,1-0,5 %
relatif) sur accum/eth/swing : bruit de PROVENANCE de données (le propre
historique de la campagne varie déjà de +62,0 → +61,9 entre le 02-07 et le
04-07 sur la même fenêtre). Hypothèse arrondis symbolInfo TESTÉE ET RÉFUTÉE
(`baseline_pinned.ts` : chiffres identiques avec filtres épinglés —
exchangeInfo est géo-bloqué FR au passage, les re-runs tournent sans arrondis).
⚠ ETH IS dévie (+1,43) alors que VRX IS (même fin 2024-01) est exact → l'écart
ancien/neuf ne se limite pas à la queue 2026. **Forensic restant : diff
bit-à-bit candles ancienne base vs neuve — suspendu à la décision de
réparation (Mario).** Pas d'alerte : aucune décision de trading ne change.

### A7 — Signatures : conformes

swing WR 36 % (~33 % doc), payoff élevé, trend-follower qui dort hors bull ✓ ;
accum PF 1,63-1,64, payoff 3,5:1 documenté cohérent ✓ ; VRX PF 2,08 (2,1 doc) ✓.

## Journal

- 2026-07-15 : ouverture. Incident PG consigné (ci-dessus). Lecture complète du
  moteur (backtest.ts, simExchange.ts, trades.ts, metrics.ts, runtime.ts,
  candleStore.ts, alignOpenTime) : conventions saines par construction —
  market → open suivant (jamais le close du signal), matching AVANT la vue
  stratégie, pivots confirmés à i+right avec test d'invariance par troncature,
  3d/1w agrégés du 1d sur grille ancrée (3d : 1970-01-02 ; 1w : lundi).
  Inventaires (2 agents) : campagnes + entrepôt consignés dans la ROADMAP.
- 2026-07-15 (suite) : base neuve peuplée (Vision pur), A1 41/41, A2 0,0000 pt
  (2 sondes, 390 fills), A4 PASS (artefacts venue documentés), A5 décisions
  exactes / valeur ±0,3 % (provenance), A7 conformes, 120/120 tests. Reste :
  A6 (chasse aux 5 classes dans le code de recherche) + diff ancien/neuf
  (suspendu décision PG).
