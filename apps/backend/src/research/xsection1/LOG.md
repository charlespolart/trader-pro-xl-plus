# xsection1 — cross-section alts USDT (protocole pré-enregistré)

**Ouvert le 2026-07-15, committé AVANT toute exécution.** Horizon H1 de la
ROADMAP. Mission-cadre : trouver une stratégie qui bat les incumbents (cible
mesurable définie dans ROADMAP.md) — ou réfuter proprement.

## Mécanisme économique & priors

Dispersion énorme entre alts, flux retail par vagues d'attention, lead-lag
depuis les majors → momentum/réversion/low-vol EN COUPE (acheter les forts,
vendre les faibles, en relatif). Littérature (Liu-Tsyvinski-Wu et suiv.) :
momentum 1-4 semaines en coupe documenté, décroissant post-2021.

**Priors maison (honnêteté — 3 angles voisins déjà RÉFUTÉS)** : rotation
top-k \*/BTC pour accumuler du BTC (accum3 : −100 %) ; panier satellite
ETHBTC/SOLBTC (accum5 : 2 looks OOS épuisés, fermé) ; rotation de récolte de
funding (carry1 R1 : persistance réelle mais rotation < hold). **L'angle
VIERGE testé ici : coupe en USD, jambes longues ET courtes (market-neutral)
+ long-only vs benchmark équipondéré.** Ce qui est mort : « tourner entre
alts pour battre le hold d'un actif fort ». Ce qui est vierge : « le SPREAD
fort-faible en USD est-il un facteur net de coûts ? »

## Données & LIMITE ASSUMÉE (survivorship du pilote)

- Panel : top-20 alts USDT par liquidité ACTUELLE (BNB, SOL, XRP, ADA, DOGE,
  AVAX, LINK, DOT, LTC, MATIC, ATOM, UNI, NEAR, FIL, ETC, XLM, ALGO, VET,
  TRX, EOS), spot Binance 1d (grain primaire), 2019-01→2026-07, base 5438.
  Entrée dans le panel : à partir de la 91ᵉ bougie du symbole (warmup J max).
- ⚠ **Univers = survivants d'aujourd'hui → biais haussier sur les jambes
  LONGUES et adoucissant sur les jambes courtes.** Statut de campagne : PILOTE
  de dépistage. **Aucun candidat ne sera annoncé sans réplication sur
  l'univers survivorship-safe** (toutes les paires USDT ayant existé,
  délistées incluses — reconstructible depuis Vision comme l'univers \*/BTC
  489 paires de accum3). Un facteur MARKET-NEUTRAL (long−short) est moins
  exposé au biais que le long-only ; consigné par facteur.
- Frais : 30 bps par CÔTÉ de rotation (taker 0,10 % + slip 0,05 % ×2 marges) ;
  le turnover est mesuré et facturé sur le notionnel TOURNÉ. Stress ×2.
  (Le maker OKX réel serait moins cher — on teste au taker, conservateur.)

## Facteurs & grilles (FIGÉES — aucune optimisation dans cette passe)

Signal calculé au close du jour t, positions prises à l'OPEN de t+1 (open+1,
convention moteur), tenues K jours, jambes équipondérées, re-normalisées à
chaque rebalancement.

| Famille | Signal (à t) | Grille | # |
|---|---|---|---|
| MOM | log-ret sur J jours, skip S derniers | J∈{7,14,30,90} × S∈{0,2} × K∈{2,7} | 16 |
| REV | log-ret sur J jours (inversé) | J∈{1,3} × K∈{1,2} | 4 |
| LOWVOL | −σ des rets 1d sur 30 j | K∈{7,30} | 2 |
| CARRY | funding cumulé 7 j du perp (si dispo base 5436→export) | K∈{2,7} | 2 (sinon consigné « non testé ») |

Portefeuilles par facteur : **L/S** = long top-30 % (6 noms) − short
bottom-30 % (6) ; **LO** = long top-30 % seul. Benchmarks : EW-20 (long-only)
et 0 (L/S). Total ≈ 24 configs × 2 constructions = 48 stats primaires,
ledger complet, BH-FDR 10 % PAR FAMILLE sur la stat primaire.

## Éval & nulls (pré-enregistrés)

- Primaire : **Sharpe net annualisé** de la série quotidienne du portefeuille
  (√365) sur l'IS. Null : **permutation des rangs en coupe** — à chaque
  rebalancement, les rangs du signal sont mélangés entre les actifs VIVANTS ce
  jour-là (structure temporelle et coûts identiques, information de coupe
  détruite), 1000 tirages → p = P(Sharpe_null ≥ Sharpe_obs).
- Secondaire (survivants) : monotonie des quintiles (Q5−Q1 même signe que
  L/S, progression), turnover, maxDD, sous-périodes (2019-21 vs 2022-23).
- **Placebo machinerie** : pipeline COMPLET sur panel à rendements mélangés
  par blocs de 30 j PAR ACTIF (détruit coupe ET momentum, garde les
  distributions) → ~1 % de stats à p<0,01, ≤3 % toléré, sinon stop.
- **Contrôle positif** : facteur PLANTÉ — +20 bps/j injectés sur 4 actifs
  fixes d'un panel placebo → le pipeline MOM doit les retrouver à p<0,01,
  L/S Sharpe net > 1. Sinon machinerie suspecte, stop.

## Barre de survie (avant OOS — inamovible)

1. IS 2019-07→2024-01 : p_perm < 0,01, survivant BH-FDR 10 % par famille ;
2. L/S : Sharpe net ≥ 0,8 ET maxDD < rendement annualisé (Calmar > 1) ;
   LO : bat EW-20 (ΔCAGR ≥ +3 pts ET DD ≤) ;
3. quintiles monotones (pas juste les extrêmes) ;
4. plateau : les voisins de grille (J±1 cran, K±1 cran) gardent ≥ 50 % du
   Sharpe ;
5. coûts ×2 : Sharpe net > 0,5 ;
6. OOS 2024-01→2026-07 UNE passe : même signe, Sharpe ≥ 50 % de l'IS ;
7. **réplication survivorship-safe OBLIGATOIRE** (univers complet délistées
   incluses) avant tout mot au-delà de « candidat pilote » ;
8. porte finale : comparaison aux incumbents selon ROADMAP (duel direct ou
   contribution portefeuille), WF ancré.

## Journal

- 2026-07-15 : protocole écrit et committé avant exécution. Téléchargement
  top-20 en cours (ensure_alts.ts). Machinerie : xsection.py à écrire
  (panel → facteurs → éval permutation → placebo/contrôle → IS).
