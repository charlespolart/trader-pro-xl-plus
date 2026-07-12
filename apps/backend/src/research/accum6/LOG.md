# Campagne accum6 — liquidations & open interest (2026-07-12)

**Mission** : la famille « positionnement dérivés » — liquidations (long/short, par
exchange) et open interest — comme signaux d'accumulation BTC. Porte ouverte par la
découverte Coinalyze (API gratuite) : daily JAMAIS purgé → 6,5 ans d'historique.

## Données (source : Coinalyze, header api_key, 40 req/min)

- Liquidations daily long/short : Binance 2020-01-25→, OKX 2020-03-28→, Bybit
  2020-06-23→, BitMEX 2020-01-29→. ⚠ unités hétérogènes (linear = coin, inverse =
  contrats USD) → normaliser (×prix ou z-scores par marché).
- Open interest daily : Binance 2020-01-21→ (la donnée introuvable ailleurs en
  gratuit — l'API Binance native = 30 j).
- Funding daily 2020-01-21→ (cross-check avec notre table funding Binance).
- Intraday : ~1 500-2 000 points glissants (≈ 1 an en 4h) — snapshot pris, le
  collecteur maison (option A) l'étendra vers l'avant.
- ⚠ MÉTHODO : le flux forceOrder Binance est ÉCHANTILLONNÉ par l'exchange
  (~1 liq/s/symbole max) — signal indicatif, pas exhaustif ; identique chez tous
  les fournisseurs. Les 4 exchanges = 4 mesures quasi indépendantes du même
  phénomène → axe de réplication principal.

## Protocole (hérité accum2-5, adapté à la profondeur)

IS = 2020-01→2024-01 (4 ans : COVID, bull 21, bear 22, range 23). OOS =
2024-01→2026-07, UNE passe par famille. Moitiés IS (coupure 2022-01). Nulls par
décalage circulaire compacté. Réplication exigée : ETH + cross-exchange (signe
cohérent sur ≥ 3 des 4 venues). t non-chevauchant. Ledger de tout. Étude de
séparation AVANT tout backtest ; grain daily d'abord (le seul profond).
⚠ RUPTURE 2021-04-27 (cf. deep search) : features RELATIVES uniquement (z par
venue, ratio borné) — jamais de niveaux USD absolus en signal ; slice de
robustesse post-rupture (2021-05→2024-01) exigée en plus des moitiés.

## Priors honnêtes

- Famille « capitulation » réfutée en proxys volume/flow (accum2 N4 : prédit le
  rebond, mauvais côté, n minuscule) — les liquidations sont la mesure PROPRE de
  la même idée : le label « forcé » est l'info nouvelle.
- Famille sentiment 0/5 — mais liquidations/OI = POSITIONNEMENT, pas sentiment :
  mécanique (deleveraging), pas déclaratif.
- BTC est momentum : si « cascade de liq longues → rebond » est vrai, c'est un
  signal de RACHAT (timing rebuy v2/VRX), pas de vente. Les fenêtres de VENTE
  viendraient plutôt de l'OI (build-up de levier) ou des cascades de shorts.

## Deep search externe (Opus 4.8, rendu 2026-07-12)

Enquête « sources d'historique liquidations/OI » — conclusions croisées avec
notre acquis Coinalyze :

- **RUPTURE MÉTHODOLOGIQUE 2021-04-27, indépendante du fournisseur** : Binance a
  plafonné forceOrder à 1 push/s/symbole (le plus gros ordre par 1000 ms) ;
  Bybit a coupé le flux complet nov 2021 → repris fév 2025. TOUT dataset
  2019→2026 est donc échantillonné à partir de mi-2021, quel que soit le vendeur.
  Magnitudes USD systématiquement sous-estimées post-2021 → features relatives/
  normalisées obligatoires, la coupure moitiés 2022-01 tombe bien (moitié 2 =
  100 % post-rupture), + slice robustesse 2021-05→2024-01.
- **Coinalyze validé comme bootstrap** (gratuit, 40 req/min, daily éternel,
  intraday 1500-2000 pts glissants non backfillable — aucune archive tierce ne
  contourne la purge).
- **Tardis.dev = seule source tick pré-2022** (Binance liq 2020-01-07→, OKX/Bybit
  2020-12-18→) MAIS l'historique complet exige le tier Business (~3 000 $/mois
  indicatif, facturation annuelle, min 300 $, devis au checkout — Solo/Pro yearly
  = 4 ans en arrière seulement → 2022). Stratégie si besoin : acheter 1 cycle,
  tout télécharger, résilier. CSVs du 1er du mois GRATUITS pour spot-check.
- **Piste intraday à 0 € (venue Binance)** : data.binance.vision publie des CSV
  `liquidationSnapshot` (um/cm) + `metrics` (OI) — flux échantillonné 1/s
  post-2021 mais couvre toute la plage ; archive parfois en retard (à valider
  avant confiance). S'ajoute à notre plan si l'intraday devient nécessaire.
- **Coinglass** : daily all-time dès 29 $/mois mais sub-horaire verrouillé
  (1 min : 6-12 j ; 5 min : 30-60 j ; 1 h : ≤720 j) — inutile pour nous sauf
  cross-check daily one-off (Standard 299 $ commercial). **Velo Data** : yearly
  = historique complet ≥1 min (mid-tier post-2022). **Glassnode** : OI
  point-in-time (anti look-ahead), fort pour l'OI, liq agrégées seulement.
  **Hyperliquid Reservoir** : S3 gratuit, venue seule. **Kaiko** (a racheté
  Amberdata) : institutionnel, sales-only. **Pas de liquidations SPOT publiques**
  (margin forcé = privé par compte) — ne jamais bâtir là-dessus.
- **Décision post-deep-search** : étude daily d'abord (0 €, inchangé). Si edge
  ET besoin intraday : CSVs Binance gratuits → Velo/Tardis Solo (post-2022) →
  Tardis Business uniquement si le pré-2022 tick est indispensable.

## Plan

- [x] 1. fetch_coinalyze.py — cache daily 4 venues + OI + funding, BTC & ETH (+ 4h récent).
      Fait 2026-07-12 : BTC liq 2361/2296/2206/2319 j (binance/okx/bybit/bitmex),
      OI+funding 2365 j, ETH idem, 4h 2004 pts (2025-08-11→).
- [x] 2. liq_study.py — séparation : liq long/short/total (z, ratio, spikes), ΔOI,
      combos capitulation/squeeze → fwd 1-20 j, quintiles + event studies extrêmes.
      Fait 2026-07-12 (+ liq_study2.py, look n°2 daily : extrêmes en rang,
      double-tri momentum, oi_z par année).
- [x] 3. Réplications ETH + cross-venues ; verdict famille ; OOS une fois si survie.
      Fait 2026-07-12 : **NO-GO daily — OOS NON consommé** (critères pré-enregistrés
      non atteints, aucune passe 2024→2026 effectuée).
- [x] 4. Outil de synchro incrémental REST (remplace l'option A « collecteur WS »,
      décision Mario 2026-07-12) : relançable à la demande, backfill daily
      idempotent + snapshot/fusion de la fenêtre intraday glissante → Postgres.
      Relance ≥ mensuelle = intraday 1h/4h continu sans temps réel.
      **Livré : sync_coinalyze.py** — table PG locale `coinalyze(series, t,
      payload jsonb)`, 54 séries (liq + OI ×4 venues + funding, BTC & ETH,
      daily/4h/1h), 123 439 lignes au premier run (2026-07-12). Valeurs stockées
      BRUTES (normaliser à l'étude). ⚠ interprétation : les « trous » daily des
      venues calmes (OKX 2 j, Bybit 5-6 j, BitMEX 38-118 j) = jours à ZÉRO
      liquidation omis par l'API → traiter comme 0, pas comme manquant. Bonus :
      BitMEX intraday profond (4h→2023, 1h→2024, venue peu active). L'entretien
      = relancer l'outil ≥ 1×/mois (le 1h ne couvre que ~2,5 mois glissants).

## Ledger des essais

Setup commun : daily Coinalyze 4 venues USD-normalisées (linéaires ×prix, BitMEX
inverse déjà USD), z log1p causal 180 j par venue puis moyenne (≥2 venues),
IS 2020-01→2024-01, sanity OK (médianes 3-10 M$/j homogènes ; corr(z_long, ret
même jour) -0,31 / z_short +0,34 = alignement causal confirmé ; top-8 z_long =
les crashs connus 2021-04-18, Celsius, FTX…). Barre pré-enregistrée : p<0,01
(null décalage circulaire) + moitiés même signe + |t nonoverlap|≥2 + signe
conservé post-rupture 2021-05.

| # | Idée | Où | Verdict |
|---|------|----|---------|
| 1 | z liq long/short/total → fwd 1-20 j | liq_study.py | IC + partout (max +0,19 h20), venues 4/4 cohérentes, MAIS p>0,05 (sauf h1 épars), t<2, moitiés décroissantes (+0,17→+0,04), post-rupture ≈0, BH-FDR **0/45** ; ETH ≈0 → proxy de régime bull 2020-21, pas de signal |
| 2 | capitulation = extrêmes longs & prix bas (z≥2 puis rank roulant ≥0,98 4-venues) | liq_study.py + 2 | **RÉFUTÉ franc** : fwd10 -1,6 % vs base +1,1 % (n=11) ; conditionnel roc30<0 : aucune séparation (T1-T3 plats négatifs) ; top-8 jours extrêmes → le crash CONTINUE. Même verdict qu'accum2 N4, cette fois avec le label « forcé » propre — la thèse rachat-sur-cascade est morte |
| 3 | squeeze = extrêmes shorts en hausse (rank≥0,98) | liq_study2.py | fwd10 +8 %, fwd20 +14,8 % (n=12) MAIS p10 0,92 ; les 12 jours = ~9 épisodes TOUS à roc30 +10..+66 % = marqueur « rallye déjà en cours » (couvert par v2/VRX) ; IC résiduel anti-momentum +0,11 mais concentré 2020-21, post-rupture +0,04, ETH 0 |
| 4 | ratio (l−s)/(l+s) + lissé 7 j | liq_study.py | mort : IC ±0,01-0,07, signes instables selon h |
| 5 | ΔOI 1 j / 7 j | liq_study.py | mort : IC ~0 partout ; events purge/build-up q10/q90 p 0,94/0,73, moitiés incohérentes |
| 6 | oi_z (niveau OI Binance, z log 180 j) → fwd 20 j | liq_study.py + 2 | **SOUS-SEUIL, à surveiller** : IC -0,235 h20, quintiles monotones (Q1 +5,0 % → Q4 -2,1 %), signe 3/4 années, sens = prior « build-up de levier → faiblesse » ; mais p 0,13, 2022 = 0, dominé par 2023 → retester avec 2-3 ans de données sync en plus, critères à pré-enregistrer AVANT |
| 7 | funding_z (référence, famille déjà 0/5) | liq_study.py | confirmé mort (IC -0,04, p>0,2) |

**Verdict famille : NO-GO au grain daily.** Les liquidations daily n'apportent
rien au-delà du contexte prix (|ret| corr +0,50, régime) ; la seule piste
au-dessus du bruit visuel (oi_z) reste sous la barre. L'OOS 2024→2026 n'a PAS
été regardé — il reste vierge pour un éventuel retest futur (oi_z ou grain
intraday une fois l'historique sync accumulé).

## Journal

- 2026-07-12 : campagne ouverte. Profondeur Coinalyze vérifiée (2020-01→, daily
  jamais purgé). Clé API utilisateur active.
- 2026-07-12 (suite) : fetch exécuté (13 séries, 1.9 MB en cache). Deep search
  Opus 4.8 intégré — rupture d'échantillonnage 2021-04-27 actée au protocole
  (features relatives + slice post-rupture). Option A (collecteur WS temps réel)
  ABANDONNÉE sur décision Mario au profit d'un outil de synchro incrémental REST
  relançable (daily backfill + snapshots intraday fusionnés).
- 2026-07-12 (soir) : étude de séparation exécutée (liq_study.py + liq_study2.py,
  2 looks daily consignés). **Verdict : NO-GO daily, OOS non consommé.** La
  capitulation-rachat est réfutée proprement (la cascade continue) ; le squeeze
  shorts est un marqueur de rallye déjà couvert ; oi_z seul sous-seuil cohérent
  (à retester plus tard, critères à pré-enregistrer). Reste du chantier : outil
  de synchro (plan 4) pour étendre daily + construire l'intraday vers l'avant.
