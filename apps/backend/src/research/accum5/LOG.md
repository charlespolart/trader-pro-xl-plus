# Campagne accum5 — la piste satellite rotation, faite proprement (2026-07-11)

**Mission** : réveiller la piste parquée A2 (accum3 : donchian top-10 majors, OOS +21,4%
mais DD -47,9%) en « poche satellite haute-variance assumée » — demande utilisateur.

## ⚠ HONNÊTETÉ MÉTHODOLOGIQUE — regard OOS n°2

L'OOS 2024-26 de la famille rotation a DÉJÀ été regardé une fois (accum3 A2 : +21,4%,
DD -47,9%, 2024 +34/2025 -21/2026 +14). Tout regard supplémentaire = look n°2, déclaré,
avec critères d'acceptation PRÉ-ENREGISTRÉS avant de regarder, et barre RELEVÉE.
Tout le design se fait sur IS 2018-04→2024-01 (alts : depuis listing), avec réplication
par sous-univers disjoints quand applicable, params donchian 15/5 IMPORTÉS d'accum2/X2
(jamais re-fittés).

## CONTRAINTE DÉCOUVERTE : l'univers exécutable OKX

OKX spot ne cote en BTC que **3 paires : ETH-BTC, SOL-BTC, OKB-BTC** (API publique,
2026-07-11). Le top-10 « direct » est inexécutable. Deux voies :

- **Track A — déployable tel quel** : bots donchian 15/5 par paire sur ETHBTC et SOLBTC
  (OKB : pas d'historique Binance, écarté). Mono-symbole, dénomination quote (BTC),
  architecture bot actuelle, zéro chantier. X2 (ETHBTC) déjà validé IS (+391%, plateau
  N10-40×M5-20 entier, coûts ×3 OK) ; SOLBTC = réplication indépendante à params gelés.
- **Track B — chantier produit requis** : top-10 en 2 jambes USDT (vendre BTCUSDT,
  acheter ALTUSDT) → 0,30%/côté. À quantifier sur IS : si ça s'effondre à ce coût,
  le chantier multi-symbole ne vaudra jamais le coup pour cette famille.

## Plan

- [ ] 1. Track A IS : donchian 15/5 (gelé) sur ETHBTC + SOLBTC (mini-sim quote-BTC,
      frais 0,15%/côté, stress 0,20-0,30) ; par-moitiés ; panier 50/50.
- [ ] 2. Gate structurel pré-enregistré : VETO si BTC en bear confirmé (hypothèse :
      les crashs alt/BTC co-occurrent avec les bears BTC — même esprit que le
      confirmMode 'both' d'eth-accumulator). Testé sur IS SEULEMENT.
- [ ] 3. Track B IS : top-10 à 0,30%/côté (2 jambes) vs 0,15 → verdict chantier.
- [ ] 4. Critères OOS pré-enregistrés PUIS look n°2 déclaré (Track A figé, et Track B
      seulement si l'IS 2-jambes tient).
- [ ] 5. GO → stratégie produit ratio-trend + parité + baselines + doc ; NO-GO → ledger.

## Ledger des essais

| # | Idée | Où | Verdict |
|---|------|----|---------|
| S1 | Track A IS : donchian 15/5 GELÉ par paire | ratiopairs.py | ETHBTC +391,9% (reproduit X2 à l'unité ✓, DD -28,9) ; SOLBTC +1580,7% (1er test, zéro fit, DD -64,3, 2021 +731%) ; panier 50/50 +887,5% / DD -44,0 ; frais ×2 → -4% relatif (trend multi-semaines) |
| S2 | Gate veto bear-BTC (hypothèse pré-enregistrée) | ratiopairs.py | ✗ NE RÉPLIQUE PAS : aide SOL (+1070 pts, 2022 -22→+2) mais ampute ETH (-190 pts — ETHBTC a fait +56% PENDANT le bear 2018 : l'hypothèse de co-occurrence est partiellement fausse). Gate écarté, config SANS veto |
| S3 | OKB-BTC (3e paire OKX) | — | écarté : pas d'historique Binance, token d'exchange (buyback) structurellement à part |

## CRITÈRES OOS PRÉ-ENREGISTRÉS (écrits AVANT le look n°2, barre relevée)

Config figée : donchian 15/5, sans veto, panier 50/50 ETHBTC+SOLBTC, frais 0,15%/côté.
Contexte connu AVANT le look : ETHBTC-donchian holdout accum2 ≈ -7,9% (2024-26) ;
top-10 accum3 : +21,4% / DD -47,9%. SOLBTC OOS : jamais vu.
**GO seulement si : panier net > 0 ET DD panier > -30% ET chaque paire > -10%.**
Sinon NO-GO définitif de la famille (2 looks épuisés), satellite fermé.

| S4 | OOS look n°2 DÉCLARÉ (panier figé sans veto) | ratiopairs.py oos | **✗ ÉCHEC au critère pré-enregistré : panier -3,6% (il fallait >0)**. ETHBTC -7,9% (== holdout accum2 connu, cohérence ✓), SOLBTC +0,7%, DD -27,2%. NO-GO DÉFINITIF — 2 looks épuisés |
| S5 | Track B : top-10 aux frais 2-jambes (0,30%/côté), IS only | inline | IS tient (+397% vs +642%) — les coûts ne sont PAS le blocage ; mais l'OOS connu du top-10 (+21,4%/DD-47,9% → ~+10% après 2 jambes) disqualifie. **Chantier multi-symbole NON justifié** |
| S6 | eth-accumulator dans le portefeuille BTC-max (question utilisateur) | ethmix.ts | ✗ pour l'objectif BTC : la strat gagne DANS SA dénomination (OOS +14,2% ETH, DD -23,8 — elle fait bien son job) mais la poche convertie en BTC fait **-43,0% OOS / DD -73,5** (le ratio ETHBTC a perdu -50,1%) ; le trio v2+VRX+ethacc passe de +10,9% (duo) à **-7,1%** OOS. Corr faible (0,13-0,31) mais la diversification ne sauve pas un actif à -43%. eth-acc = mandat ETH-max séparé (si on détient de l'ETH volontairement), PAS un ingrédient du portefeuille BTC-max — il faudrait un edge ETHBTC, exhaustivement réfuté (X2, E5, accum5) |

## VERDICT FINAL (2026-07-11) — famille rotation FERMÉE

1. La version exécutable (ETH+SOL, paires BTC réelles d'OKX, architecture actuelle) :
   IS spectaculaire (+887% panier) mais **OOS -3,6%** → échec du critère pré-enregistré.
   Le carburant (phases de surperformance alt soutenues) est absent depuis 2022 pour
   ETH et depuis 2024 pour SOL — même cause que la panne X2 d'origine.
2. La version top-10 (la seule à OOS positif, +21,4%) exige un chantier produit
   multi-symbole ET porte un DD -47,9% : disqualifiée des deux côtés.
3. Gate veto bear-BTC : non répliqué entre paires (ETHBTC montait pendant le bear 2018).
4. **Condition de réveil (la seule)** : plusieurs ANNÉES de nouvelles données OOS montrant
   un retour durable des rotations alt (le breadth/alt-share peut servir d'indicateur
   de surveillance passive — il « chuchote » déjà, cf. accum3 C1/accum4 C2 — mais AUCUN
   n'a franchi la barre comme signal).
5. Leçon d'infra : TOUJOURS vérifier l'univers exécutable OKX avant de designer une
   stratégie multi-actifs (3 paires BTC seulement : ETH, SOL, OKB).

## Journal

- 2026-07-11 : campagne lancée sur demande (« suis les autres pistes »). Contrainte
  OKX 3 paires BTC découverte AVANT le design — elle pilote tout.
- 2026-07-11 : IS fort (S1), veto non répliqué (S2), critères OOS pré-enregistrés,
  look n°2 déclaré : ÉCHEC (-3,6% vs >0 requis). Track B tranché sur IS+arithmétique.
  FAMILLE FERMÉE le jour même. Le stack reste : v2 + VRX (+ btc-swing côté USDT),
  duo 50/50 recommandé, « le range = repos ».
