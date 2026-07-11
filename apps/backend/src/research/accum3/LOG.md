# Campagne accum3 — maximiser le BTC (2026-07-11)

**Mission** : partir de 100% BTC et en avoir LE PLUS POSSIBLE à la fin (dénomination base,
benchmark = garder son BTC = 0%). Chercher des edges NOUVEAUX, toutes familles, toutes
timeframes, avec une **usine à indicateurs** (classiques + inventés) passée au crible
statistique. La v2 (btc-accumulator) reste la référence à battre/compléter :
2019→2026 +61,9%/-29,6%, full 2018→2026 +126,2%, 2024→2026 **+4,9% seulement** (pas de bear).

## Ce qu'on sait déjà (accum2, NE PAS re-tester sans angle neuf)

- 26 familles réfutées sur BTCUSDT : exits (trail/ladder/min-hold), filtres d'entrée
  (funding/vol/ATH/âge/sessions), cooldown, sizing, grains 1h/2h/8h/12h (4h = sweet spot),
  MR dans les deux sens, momentum/donchian 1d-1w (DD ×2, pas de plateau), capitulation,
  chartisme complet (34 chandeliers, H&S, DT/DB, wedges, fib, OB), S/R (pivots, ronds,
  volume profile/POC), basis perp-spot (tué par réplication ETH), CVD stratifié.
- PARQUÉS holdout-négatif (régime absent, pas edge mort) : X2 ETHBTC donchian 15/5 1d
  (IS +391%, plateau large, coûts ×3 OK — carburant = phases de surperf ETH, absentes
  2022-26) ; X3 eth-accumulator (attend un vrai bear ETH).
- Anatomie v2 : l'edge = LA MÉCANIQUE D'EXCURSION (stop cappé 5% + recross rapide +
  ré-entrée), le régime n'est que contexte. Issues des trades ~i.i.d., rien à l'entrée
  ne prédit le tirage.
- MÉTA : bear BTC = momentum + rallyes violents ; les niveaux se font traverser ;
  toujours faire l'étude de séparation AVANT le backtest ; toujours répliquer sur ETH ;
  toujours compter les essais (multiple testing).

## Angles NEUFS de cette campagne

1. **Rotation cross-section alt/BTC** (famille A) — généralise X2 : univers point-in-time
   de TOUTES les paires */BTC Binance (délistées incluses, listing S3 Vision = zéro biais
   du survivant au niveau de la liste), momentum/breakout, défaut = BTC. La panne de X2
   (ETH ne surperforme plus) est exactement ce qu'un univers répare (SOL 2023-24, etc.).
2. **Vol-harvesting régime-gated** (famille B) — constant-mix BTC/USDT à bandes,
   hors-bull : récolte le chop (2024-26 = le trou de la v2). Gagne ssi μ < w·σ²/2.
   Coûts au centre. Null = rebalances aléatoires à turnover égal.
3. **Usine à indicateurs + screening massif** (famille E) — ~120 features (TA classiques,
   estimateurs de vol, stats/entropie/Hurst, flow, structure, INVENTÉS : v-recovery
   propensity, leg persistence, failed-breakdown rate, excursion asymmetry, meta-PF de la
   mécanique v2, …) × horizons × régimes × {BTC, ETH}. Discipline : t non-chevauchant +
   IC bootstrap par blocs + BH-FDR 10% + réplication ETH + moitiés stables.
4. **Breadth alts** (famille C) — % de l'univers au-dessus de sa MA : signal de régime BTC ?
   (étude de séparation d'abord). **Ensembles v2** (famille D) — 3 phases 3d / 3 TF en
   tiers : réduction de variance, pas un edge.

## Protocole anti-overfitting (hérité accum2, OBLIGATOIRE)

1. **Périodes** : IS = 2018-04→2024-01 (alts : depuis listing). OOS = 2024-01→2026-07,
   touché UNE fois par famille au verdict. Pas de holdout supplémentaire : 2024-26 EST
   le juge de paix (régime sans bear = là où il faut un complément à la v2).
2. **Plateau obligatoire** : médiane du voisinage > baseline, jamais le meilleur point.
3. **Nulls** : timing-aveugle (même structure, timing aléatoire), block-shuffle features,
   turnover-égal pour le harvesting. Percentile ≥ 95 exigé.
4. **Stress** : coûts ×2/×3 (alt/BTC : centre 0,15%/côté, stress 0,30% = 2 jambes OKX),
   dates de départ, déphasage.
5. **Réplication** : BTC↔ETH pour les features ; sous-univers disjoints pour la rotation.
6. **Ledger de TOUT** (section Essais) — l'ampleur de la recherche pèse au verdict.
7. Étude de séparation AVANT backtest ; mini-sim AVANT moteur ; parité moteur vérifiée
   sur le candidat final.

## Données

- BTCUSDT/ETHUSDT spot 2017-08→2026-07 toutes TF ✓ (réparées accum2), funding ✓.
- Univers */BTC : visionfetch.py — enumération S3 complète, 1d pour TOUT (délistés
  compris), 4h pour les paires ayant jamais atteint le top-40 de volume BTC 90j.
  μs→ms (fichiers 2025+), dédup ON CONFLICT, queue REST pour les listés.
- ⚠ fichiers Vision monthly : ne PAS télécharger 3d/1w natifs (bougies fin de mois
  manquantes — bug accum2) ; agréger depuis le 1d.

## Ledger des essais

| # | Idée | Où | Verdict |
|---|------|----|---------|
| E1 | screening 122 features × 6 horizons × 4 régimes × {BTC,ETH} × {4h,1d} (10 008 cellules) | screen.py | 4 survivants après FDR10+|t|≥2+moitiés+réplication ETH = UNE famille réelle (vr_5_60 / hurst_spread, 4h, h30) + roc_1 1d (réversion, morte après coûts). Contrôles négatifs : ctrl_noise 0 ✓ (après correctif null par tranche compactée — 1er null naïf produisait 61 faux positifs, diagnostiqué par les contrôles) |
| E2 | causalité mécanique des 122 features (recalcul sur préfixe ×2 points) | screen.py causality | 1 lookahead attrapé et corrigé (runlen_mean_120 : fin de run = info future) — 122/122 OK ensuite |
| B1 | vol-harvesting constant-mix à bandes, gates {nonbull, neutral, always} × w × bande | harvest.py | ✗✗ RÉFUTÉ proprement : « neutral » +39% = 100% effet d'ALLOCATION (moitiés +61/-14, pari de régime) ; « nonbull » alpha rebal +7% mais le null timing-aléatoire fait MIEUX (méd +28,7%) — le déclenchement par bandes est anti-momentum sur BTC ; « always » -40..-54% (μ ≫ wσ²/2 en bull, la théorie tient) |
| V1 | VRX : quintiles vr_5_60 → fwd 5j | deepdive_vr.py | monotone BTC (+2,43% Q1 → -1,03% Q5) ET ETH (+1,73 → -1,53) — Q5 franchement négatif = vendable |
| V2 | VRX mini-sim exit-BTC hystérésis, gates × seuils quantiles | deepdive_vr.py | hors-bull q80/q60 : +119% IS, moitiés +16/+89, null timing-aléatoire percentile 98,3 (null méd -49%) |
| V3 | VRX plateau seuils ABSOLUS (in 1,05-1,25 × out 0,85-1,00) | vrx2.py | plateau entier positif (+66..+358), bloc central toutes moitiés positives → défauts 1,15/0,90 (centre, pas le pic 1,20/0,90 +358) |
| V4 | VRX cap de perte 3/5/8% | vrx2.py | neutre à légèrement négatif (la sortie « vr refroidit » s'auto-limite, pire exc -11%) → cap OFF par défaut, param exposé |
| V5 | VRX grains 1h / 1d | vrx2.py | ✗ 1h -62% (frais), 1d -39% (trop lent) — le sweet spot 4h d'accum2 se répète |
| V6 | VRX gate (EMA 150/200/250 × déclin 15/30/45) | vrx_validate.py | 9/9 cellules +149..+262 — pas de réglage fragile |
| V7 | VRX fenêtres annuelles IS + 12 départs mensuels + coûts ×2/×3 | vrx_validate.py | 8/10 fenêtres positives (2022 +150%, pertes = années de grind-recovery) ; 12/12 départs ; ×2 +62%, ×3 +19,5% |
| V8 | VRX null hors-bull (placement dans le même gate) | vrx_validate.py | réel +243,7% vs null méd -14,8% p95 +133,7 → percentile 98,3 |
| V9 | VRX OOS UNIQUE 2024-01→2026-07 (tout figé avant) | vrx_validate.py oos | **+16,9% / DD -19,7% / 19 exc** vs v2 +4,9% / -25,3% sur SA fenêtre faible — thèse du complément confirmée. Caveat : percentile null OOS 64 (19 exc, fenêtre courte) |
| V10 | VRX réplication ETH du SIM | vrx_plateau.py | mécanisme ✓ (quintiles), stratégie ✗ (+22%, DD -60%) — expression BTC-spécifique, précédent X3 ; PAS de eth-vrx |
| V11 | VRX recouvrement v2 | vrx_plateau.py | sorties jointes 27%, corr retours +0,37, mix50 IS : net +113% DD -22,3% (vs -34,5/-35,7 individuels) — VRAI diversifiant |
| V12 | port moteur btc-vrx + varianceRatio dans @tpx/core | vrxparity.ts | parité EXACTE python↔moteur (+243,7/-29,1 et +16,9/-19,7 au dixième) ; baselinecheck étendu 8/8 ✓ ; 74 tests core ✓ |
| V13 | duo v2+VRX (moteur réel, 50/50 sans rebalancement) | mix.ts | IS +179,7%/DD **-19,5%** (vs -32,5/-29,1 seuls), OOS +10,9%/-18,3%, full +214,0%/-31,5% — corr 0,42-0,48, VRAI second moteur |
| E3 | réversion 1 jour (roc_1, survivant screening) | inline | ✗ réelle (fwd -0,11%/j après gros jour vert) mais 3× sous le coût AR 0,30% ; le miroir Q1 (+0,44% après gros rouge) = déjà capturé par le rachat rapide v2/VRX |
| E4 | hash ribbon (MA30/60 hashrate blockchain.info) + growth30 | inline | ✗ p 0,25-0,86 partout, moitiés instables, corr mom30 prix +0,08 — porte on-chain fermée |
| D1 | ensemble v2 3 phases 3d / 3 TF | — | non poursuivi : la réduction de variance est déjà livrée par le mix v2+VRX (corr 0,42) sans la complexité de 3 bots ; les 3 phases 3d sont déjà prouvées positives (accum2) |
| E5 | vr_5_60 sur le RATIO ETHBTC (accumuler BTC via le cross) | inline | ✗ ne transfère pas (p 0,41-0,99, spreads ±0,4%, non monotone) — l'edge vr est une propriété du chemin des majors en USD |
| A1 | rotation cross-section alt/BTC : rank momentum 15-90j × K1-3, univers point-in-time 487 paires (volfloor 5/20 BTC) | rotation.py | ✗✗✗ MASSACRE : tout à -100% (161 éligibles médians → toujours un alt en momentum positif → jamais en BTC, et le rank achète les sommets de pumps : PIRE que le null random parmi momentum>0, -100 vs -99,3). Le beta alt/BTC 2018-24 lui-même : basket top-vol -97,7% (réalité de marché, pas un bug) |
| A2 | donchian 15/5 TIME-SERIES (params IMPORTÉS X2, zéro fit) sur top-10 majors point-in-time | rot_donchian.py | IS +642%/DD-42% mais 2021 = +390% porte tout ; top5 +656%, top20 +99%/DD-77% (dilution garbage). **OOS unique figé : +21,4% / DD -47,9%** — l'univers RÉPARE la panne X2 (OOS positif, attrape les rotations 2024) MAIS risque disqualifiant pour l'accumulation (rendement/DD 0,45 vs VRX 0,86). **PARQUÉE** : réveil si poche satellite haute-variance assumée ou filtre alt-season validé |
| C1 | breadth alts (% univers > MA50, % mom30>0, Δ30j) → retours BTC fwd 5-20j | breadth_study.py | ✗ signe cohérent et stable (froth alt → BTC faible, IC -0,08..-0,13, moitiés -0,13/-0,07) mais p 0,13-0,25 = sous la barre du null calibré — fermé, pas de filtre alt-season disponible pour réveiller A2 |

## Journal

- 2026-07-11 : campagne lancée. Baselines v2/ETH reproduites au trade près (moteur sain).
- 2026-07-11 : usine à indicateurs (122 features, 12 familles, 3 contrôles négatifs) +
  harnais stats (null décalage circulaire FFT, t non-chevauchant, BH-FDR). Les contrôles
  négatifs ont attrapé un null mal calibré (tranches) ET un lookahead (runlen) — les deux
  garde-fous ont payé le jour même.
- 2026-07-11 : famille B (harvest) réfutée par décomposition allocation/rebal + null.
- 2026-07-11 : famille VRX (variance ratio 4h) : IS +243,7%, batterie complète passée,
  OOS unique +16,9% (3,4× v2 sur sa fenêtre faible, DD moindre). GO → btc-vrx livré
  (indicateur varianceRatio + stratégie + parité exacte + baselines verrouillées).
- 2026-07-11 : univers 489 paires */BTC ingéré (691k bougies 1d, 52 min). Rotation
  cross-section RÉFUTÉE (-100% partout, le rank achète les pumps) ; donchian top-10
  X2-importé : OOS +21,4% mais DD -47,9% → PARQUÉ (répare X2 mais indéployable en
  accumulation). Breadth : cohérent mais sous la barre. Hash ribbon : réfuté.
  Réversion 1j : réelle mais 3× sous les coûts.

## VERDICT FINAL (2026-07-11)

1. **GO livré : btc-vrx** — le seul candidat à passer TOUTE la batterie (IS percentile
   98,3, plateau large, 12/12 départs, coûts ×3 positif, OOS +16,9%/-19,7% vs v2
   +4,9%/-25,3% sur la fenêtre sans bear). Recouvrement v2 : 27% → duo 50/50 :
   IS +179,7%/DD -19,5%, full 2018→2026 +214,0%/-31,5%. Livrables : varianceRatio
   (@tpx/core), strategies/btc-vrx.ts, parité exacte, baselinecheck 8/8, refit space,
   docs/btc-vrx.html, typecheck monorepo vert.
2. **1 famille réelle sur 122 features** — le taux de base de la recherche d'edges.
   Les contrôles négatifs et le test de causalité mécanique ont chacun attrapé un
   bug de pipeline le jour même : sans eux, la campagne aurait « découvert » 48
   pseudo-edges.
3. **Réfutés** : harvest/Shannon (anti-momentum structurel), rotation cross-section
   (machine à acheter les pumps), breadth (sous la barre), hash ribbon, réversion 1j
   (coûts), vr-sur-ETHBTC, grains 1h/1d, cap de perte VRX, eth-vrx.
4. **Parqués avec conditions de réveil** : donchian top-10 majors (poche satellite
   haute-variance assumée OU filtre alt-season validé) ; X2/X3 d'accum2 inchangés.
5. **Reste optionnel (produit)** : bot démo btc-vrx à créer (comme btc-swing) ;
   stage 4h/tail de visionfetch.py dispo si une recherche future en a besoin.
