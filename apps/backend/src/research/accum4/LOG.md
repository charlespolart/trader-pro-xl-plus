# Campagne accum4 — le RANGE (2026-07-11)

**Mission** : une stratégie pour les périodes de range — le régime où btc-accumulator ET
btc-vrx dorment. Demande explicite : tester le trading « traditionnel » de range
(bornes, oscillateurs, grilles) conditionné par un détecteur de range, et chercher
« partout » (cross-market, sentiment). Deux dénominations : base (accumuler du BTC en
vendant le haut du range) et quote (PnL USDT futures long/short aux bornes).

## Priors HONNÊTES (le terrain est miné — réfutations passées à ne pas re-tester telles quelles)

- MR unconditionnelle BTC : morte (toutes variantes taker+maker 15m-4h, er-flow 2026-06).
- Fade de rip en bear : mort (N1 accum2 — le forward est POSITIF après un bounce).
- Réversion 1 jour (roc_1) : réelle (IC -0,07, répliquée ETH) mais 3× sous le coût
  taker 0,30% AR (accum3 E3).
- S/R : pivots fractals cassés 73% en bear, ronds morts, volume profile/POC mort (X1).
- Shannon/constant-mix à bandes : mort (accum3 B1 — anti-momentum structurel, le null
  aléatoire bat les bandes).
- ⚠ STRUCTUREL : vr_5_60 bas (compression/range) → drift POSITIF (+2,4%/5j Q1) —
  vendre le haut d'un range comprimé = se battre contre le drift. Tout Track-1 doit
  battre ce prior.

## Angles NEUFS (pourquoi ré-ouvrir le dossier)

1. **Conditionnement** : aucune MR passée n'était gated par un détecteur de range
   VALIDÉ pour ses propriétés (persistance des bornes, richesse d'oscillation, drift≈0).
2. **Le côté SHORT en range** : jamais testé nulle part (les shorts n'ont été essayés
   qu'en momentum bear N2/N3 et rip-fade N1).
3. **L'exécution MAKER** : toutes les réfutations MR étaient à 0,15%/côté taker.
   OKX réel : spot maker 0,08%, **futures maker 0,02%/côté** (AR = 0,04% + funding) —
   des edges 7× plus petits deviennent viables. C'est LA variable qui change.
4. Cross-market (SPX/DXY/or) et part de volume alt : jamais regardés ici.

## Protocole (hérité accum2/3, OBLIGATOIRE)

IS 2018-04→2024-01 ; OOS 2024-01→2026-07 UNE passe par famille au verdict ; moitiés ;
plateau (médiane du voisinage) ; nulls à structure égale dans les mêmes périodes gated ;
réplication ETH ; stress coûts (maker→taker) ; funding historique appliqué aux shorts ;
ledger de TOUT ; étude de séparation AVANT backtest ; mini-sim AVANT moteur.

## Plan

- [ ] 1. rangedetect.py — détecteurs (ADX, BBwidth, EMA plate, donchian étroit, vr, ER,
      neutre-1d, combos) × propriétés (couverture, durée, persistance bornes,
      oscillations, drift) + réplication ETH.
- [ ] 2. rangemr.py — Track 1 spot base-denom : bornes/bollinger/RSI2/grid, taker vs maker,
      nulls. (Prior fort contre — réfuter vite si ça ne bat pas le drift.)
- [ ] 3. rangefut.py — Track 2 futures quote-denom : long zone basse + short zone haute,
      maker, SL taker au-delà des bornes, funding réel.
- [ ] 4. crossmkt.py — SPX/DXY/or laggés → BTC fwd ; alt-volume-share ; quickies.
- [ ] 5. Verdicts, livrables, doc, mémoire.

## Ledger des essais

| # | Idée | Où | Verdict |
|---|------|----|---------|
| R1 | 11 détecteurs de range (ADX/BBw/donchian étroit/EMA plate/vr/ER/neutre-1d/combos) × propriétés | rangedetect.py | ✗ AUCUN ne trouve des ranges qui oscillent : P(zone haute→mid avant cassure) = 28% base, max ~35% (n utile) vs ~55-60% nécessaires ; bornes tiennent 7 j ~40-55% partout ; les meilleures cellules ne répliquent PAS sur ETH (40%→14%). Les ranges BTC se résolvent par CASSURE |
| R2 | steelman géométrie : W60/120 × zone 0,8/0,9 × cible mid/retrace-0,25W | rangemr_probe.py | hit rates 60-71% en retrace MAIS mécanique (cible courte vs stop long) — tranché par l'EV R4 |
| R3 | MR d'oscillateur courte (RSI2/RSI14/bb_pos extrêmes), gated range, h6-24 | rangemr_probe.py | ✗✗ SIGNES INVERSÉS PARTOUT : suracheté → fwd POSITIF (+1,0..+1,6%), survendu → NÉGATIF (−0,5..−1,4%), spreads −15× à −72× le coût maker DANS LE MAUVAIS SENS — le BTC est momentum jusque dans ses ranges (cohérent N1/MR er-flow/roc_1). Track 1 spot (vendre le haut du range en base denom) mort par la même donnée + drift positif |
| R4 | EV réelle fade de bornes FUTURES (maker 0,02%, SL taker, timeout market, funding historique signé) | rangefut.py | ✗✗ 7/8 cellules négatives malgré WR 58-71% ; **le côté short perd dans TOUTES les cellules** (−1 à −62%, co-VRX 12-19% = pas une redondance, une perte) ; l'unique cellule positive (+15,5%/5,7 ans, EV +0,15%) = longs seuls (+20,5%) = beta d'achat de creux, moitiés +2/+13 ; funding +2-6% cumulés n'y change rien. LE PROBLÈME N'EST PAS LES FRAIS, C'EST LE SENS |

| C1 | SPX / DXY / OR laggés (Yahoo, ret 1j/5j, alignement causal close US → 00:00 UTC) → BTC fwd 1/3/5j | crossmkt.py | ✗ PLAT : |IC| < 0,04 partout, p 0,14-0,92, moitiés incohérentes — aucun pouvoir prédictif quotidien. (Stooq désormais derrière un mur anti-bot JS → Yahoo chart API.) |
| C2 | part de volume alt (Σ qv */BTC ÷ qv BTCUSDT, z-90j) → BTC fwd 3-20j | crossmkt.py | ✗ même famille que le breadth accum3 : signe cohérent (froth alt → BTC faible, IC -0,07..-0,14, moitiés stables) mais p 0,027-0,068 = SOUS LA BARRE (0,01). Le « sentiment alt » chuchote sur 3 mesures différentes mais ne franchit jamais le seuil |
| R5 | TF plus courts (15m-1h) pour la MR de range | — | non re-testé : déjà couvert par er-flow 2026-06 (« toutes variantes taker+maker 15m-4h » mortes) ; TF plus longs (bornes 1d/hebdo) : n d'événements ~30-50/6 ans = invalidable proprement |

## VERDICT FINAL (2026-07-11) — campagne intégralement NÉGATIVE, et c'est un résultat

1. **Le range trading traditionnel est RÉFUTÉ sur BTC 4h, à chaque étage** :
   les bornes ne tiennent pas (retour au mid avant cassure : 28% base, max 35% utile,
   pas de réplication ETH) ; les oscillateurs sont À CONTRESENS (suracheté → hausse,
   survendu → baisse, y compris DANS les ranges — le BTC est momentum jusque dans ses
   ranges) ; l'EV futures réelle est négative dans 7/8 cellules malgré 58-71% de WR,
   et LE CÔTÉ SHORT PERD PARTOUT. Le problème n'est PAS les frais (maker 0,02%
   généreusement supposé) : c'est le SENS. Aucune optimisation ne répare ça.
2. **Cross-market plat, sentiment alt sous la barre** (3 mesures cohérentes —
   breadth, alt-share — qui ne franchissent jamais p<0,01 : famille classée
   « chuchote mais ne prouve pas », ne pas re-tester sans donnée NOUVELLE).
3. **La bonne stratégie de range pour l'accumulation existe déjà : c'est le
   défaut du stack.** En compression le drift BTC est POSITIF (+1,4%/7j vr<1) →
   détenir son BTC (0 trade, 0 frais) est le meilleur coup connu ; VRX ramasse les
   bouffées qui terminent les ranges ; la v2 prend les vrais bears. Il n'y a PAS de
   4e moteur à construire ici — le trou « range » n'est pas un trou, c'est du repos.
4. Aucun livrable stratégie (honnêteté du verdict > livrer du bruit). Livrables
   recherche : rangedetect/rangemr_probe/rangefut/crossmkt réutilisables.

## Journal

- 2026-07-11 : campagne lancée (3e stratégie btc-vrx tout juste livrée ; le trou
  restant = range).
- 2026-07-11 : détecteurs → séparation → steelman géométrique → oscillateurs
  (signes inversés) → EV futures réelle (funding inclus) : réfutation en cascade,
  chaque étage confirmant le précédent. Cross-market plat. Alt-share sous la barre.
  CAMPAGNE CLOSE le jour même — le protocole « séparation avant backtest » a évité
  des jours de sweeps inutiles.
