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

## Priors honnêtes

- Famille « capitulation » réfutée en proxys volume/flow (accum2 N4 : prédit le
  rebond, mauvais côté, n minuscule) — les liquidations sont la mesure PROPRE de
  la même idée : le label « forcé » est l'info nouvelle.
- Famille sentiment 0/5 — mais liquidations/OI = POSITIONNEMENT, pas sentiment :
  mécanique (deleveraging), pas déclaratif.
- BTC est momentum : si « cascade de liq longues → rebond » est vrai, c'est un
  signal de RACHAT (timing rebuy v2/VRX), pas de vente. Les fenêtres de VENTE
  viendraient plutôt de l'OI (build-up de levier) ou des cascades de shorts.

## Plan

- [ ] 1. fetch_coinalyze.py — cache daily 4 venues + OI + funding, BTC & ETH (+ 4h récent).
- [ ] 2. liq_study.py — séparation : liq long/short/total (z, ratio, spikes), ΔOI,
      combos capitulation/squeeze → fwd 1-20 j, quintiles + event studies extrêmes.
- [ ] 3. Réplications ETH + cross-venues ; verdict famille ; OOS une fois si survie.
- [ ] 4. Option A (collecteur WS maison) — infra séparée, en parallèle.

## Ledger des essais

| # | Idée | Où | Verdict |
|---|------|----|---------|

## Journal

- 2026-07-12 : campagne ouverte. Profondeur Coinalyze vérifiée (2020-01→, daily
  jamais purgé). Clé API utilisateur active.
