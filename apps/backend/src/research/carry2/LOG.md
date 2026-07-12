# Campagne carry2 — carry cross-section sur les alts (2026-07-12)

**Mission** (GO Mario : « essaye avec des alts, explore les axes ») : l'axe R1 du
rapport carry1. Le funding des alts est-il assez riche ET assez persistant pour
qu'une rotation batte le carry BTC/ETH simple, net de coûts et de délistements ?

## Protocole PRÉ-ENREGISTRÉ (écrit avant tout téléchargement de données)

- **Univers** : TOUS les perps *USDT de l'archive Binance (fundingRate mensuel),
  délistés inclus → sans biais de survivance. Exclus : USDC/BUSD (doublons) et
  contrats datés. Éligibilité au mois m : ≥ 90 j d'historique au 1er de m ET
  événements couvrant le mois de formation m-1.
- **Comptabilité** : identique carry1 (funding exact par événement, net efficace
  ×0,83, coûts 0,4 %/cycle par slot ; sensibilité 0,8 % pour la rotation — le
  slippage alts est pire que majors).
- **IS 2020-01 → 2024-01 ; OOS 2024-01 → 2026-06, UNE passe si survie.**
- Études (aucune variante au-delà de ce qui suit) :
  1. **Descriptif** : distribution cross-section du funding annualisé par année
     (médiane, quartiles), part des symboles au-dessus de BTC.
  2. **Persistance** : Spearman cross-section funding(m-1) → funding(m) par
     mois ; moyenne, moitiés (coupure 2022-01) ; déciles de formation → funding
     réalisé le mois suivant.
  3. **Paniers (IS)** : benchmarks BTC hold / ETH hold / equal-weight univers
     éligible (rebalance mensuel, coûts sur turnover réel, délistement = sortie
     forcée coûtée) ; **rotation top-10** par funding des 30 j de formation,
     equal-weight, coûts par changement de slot. N=10 et formation 30 j FIGÉS
     ici — aucun autre N, aucune autre fenêtre ne sera regardé.
  4. **R4, un seul look (BTC/ETH, données carry1)** : poids hebdomadaire =
     percentile du funding 90 j dans l'année roulante (0..1), coûts 0,4 % ×
     |Δpoids|, verdict binaire : bat hold net ou pas.
- **Barre de survie IS (avant tout OOS)** : rotation top-10 net efficace ≥
  BTC hold net + 3 pts/an en moyenne IS, ET persistance de même signe positif
  sur les deux moitiés. **Critères OOS si survie** : rotation ≥ BTC hold net
  + 2 pts/an sur 2024→2026. Sinon : famille close, OOS non consommé.
- **Caveats pré-inscrits** : (a) liquidité/capacité NON modélisée en phase 1 —
  le funding riche est souvent illiquide ; si survie IS, la phase 2 joint les
  volumes et applique un filtre de tradabilité (pré-enregistré à ce moment-là)
  AVANT la passe OOS ; (b) côté produit, la jambe spot exige que l'alt existe
  en spot sur OKX — contrainte vérifiée en phase produit ; (c) funding négatif
  violent possible sur alts (le short PAIE pendant les squeezes) — inclus
  tel quel dans la compta.

## Plan

- [x] 1. fetch_funding_all.py — funding mensuel de tous les perps USDT → PG.
      Fait : 791 symboles, 2 425 126 événements, 0 erreur (⚠ urllib sans
      keep-alive plafonne à ~4 fichiers/s — `curl --parallel` a fait ×20).
- [x] 2. xs_study.py — études 1-4, IS seulement.
- [x] 3. Verdict vs barre : **ÉCHEC — OOS non consommé, famille close en l'état.**

## Résultats (2026-07-12, protocole appliqué tel quel, IS 2020-01→2024-01)

1. **Distribution** : les alts paient plus que BTC en bull (2020 : médiane
   +20,3 % vs BTC +12,6 %, 83 % des symboles au-dessus ; 2021 : +28,7 % vs
   +25,4 %) mais 2022 = médiane **négative** (-0,97 %, 15 % au-dessus de BTC).
   Le carry alts est un actif de régime bull ; en bear le short PAIE.
2. **Persistance : forte et propre** — IC rang moyen +0,457, 43/43 mois
   positifs, moitiés +0,43/+0,48, déciles monotones D1 -3,6 % → D10 +17,7 %/an
   net. La partie « signal » de la barre passe haut la main.
3. **Paniers** (net efficace, coûts 0,4 %/cycle/slot) : BTC hold +11,13 %/an ;
   **ETH hold +13,37 %** ; EW univers +10,49 % ; rotation top-10 +13,14 %
   (pire mois -0,50 %, 2022 -0,68 %) ; rotation à 0,8 % de coûts : +8,55 %.
   **Écart rotation − BTC : +2,05 pts/an < +3 requis.** Et ETH hold bat la
   rotation : la prime alts se capte déjà, sans churn, avec ETH.
4. **R4 (overlay sizing BTC, look unique)** : +3,31 %/an vs hold +7,87 %
   (exposition moyenne 41 %) — **ne bat pas hold**, mort. Troisième échec du
   timing de carry (règle 7 j, percentile) : hold reste invaincu.

**VERDICT : barre pré-enregistrée NON atteinte** (persistance ✓ mais edge net
insuffisant). OOS 2024→2026 jamais regardé. Le gisement existe (D10 +17,7 %)
mais le turnover mensuel le rend incapturable à nos coûts — tout retest
(construction low-turnover, filtre liquidité) exigera un NOUVEAU
pré-enregistrement, l'OOS reste vierge.

**Enseignement produit** : le carry optimal mesuré = **duo BTC+ETH hold**
(toutes les alternatives testées — règle 7 j, overlay percentile, rotation
alts, EW univers — perdent contre hold). La suite à plus forte espérance :
R2 (mesurer le vrai facteur capital en démo).

## Journal

- 2026-07-12 : campagne ouverte, protocole figé. Univers S3 recensé : ~875
  répertoires de symboles (une page, non tronquée).
- 2026-07-12 (nuit) : fetch complet (791 perps, 2,43 M événements) puis étude.
  Verdict : famille close, OOS préservé. R3 (multi-venue) consigné au LOG
  carry1 ; R4 mort ; reste R2 (démo) et R5 (destination du yield) côté produit.
