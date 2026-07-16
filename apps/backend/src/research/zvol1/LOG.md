# zvol1 — facteur VOLUME ANORMAL cross-section (N2, protocole pré-enregistré)

**Ouvert le 2026-07-17, committé AVANT toute exécution.** Thèse : le volume
anormal d'un alt (vs sa propre histoire) marque pump/distribution — le
forward qui suit est-il systématique (réversion post-pump ? continuation ?).
Direction NON présumée : le L/S de la machinerie sort le signe, la
multiplicité est comptée par BH.

## Définition (FIGÉE)

- **Signal ZVOL** : z-score EXPANSIF du log(quote_volume 1d) vs les 90 j
  passés (UN seul lookback, figé — aucune grille de lookback).
- Machinerie xsection_u RÉUTILISÉE telle quelle (parité prouvée 5,6e-17) :
  quintiles TOPQ 0,30, LO et LS, K ∈ {2, 7} → **4 cellules**, BH-FDR 10 %.
- Univers 606 survivorship-safe, WARMUP 91 j, coûts 30 bps/côté.
- IS 2019-07→2024-01 ; OOS 2024-01→2026-07 (une passe si chaîne IS tenue).

## Garde-fous

- **Placebo** : VOLUMES iid-shufflés par colonne (prix réels) → la
  sélection ne doit rien produire (~1 % à p<0,01).
- **Contrôle planté** : signal = forward t+1 volé (fuite délibérée) → doit
  exploser (pattern validé leadlag1).
- Null : réétiquetage de colonnes (le validé). Barre chaîne standard :
  BH p<0,01, |Sharpe| ≥ 0,8, Calmar > 1, coûts ×2 → > 0,5, stabilité
  annuelle, OOS ≥ 50 %.

## Journal

- 2026-07-17 : protocole écrit et committé avant exécution.

## IS (2026-07-17) — machinerie ✓, l'info est dans le SHORT des pumps

- Contrôle planté : +14,54 ✓ ; placebo volumes iid : 0/4 ✓.
- Direction longue (long les pumps) : massacre uniforme (p=1,0000 — pire
  que 100 % des nulls → information dans le signe opposé, lecture du signe
  libre prévue au protocole, |Sharpe| dans la barre).
- **Direction miroir (short quintile volume-anormal-max / long calmes) :
  K7 LS Sharpe +1,25, +47,7 %/an, DD 30,9 %, Calmar 1,54, p=0,001** ;
  K2 LS +0,96/0,92 (Calmar < 1, coûts K2) ; BH sur les 8 cellules
  cumulées : K7 LS passe largement. → passe critères 1-2 ; critères 3-4
  puis OOS conditionnel dans pass2.py (en cours).

## VERDICT (2026-07-17) : ⛔ N2 CLOS au critère 4 — facteur réel, inexploitable aux coûts

pass2 (parité portfolio_cm 0.00e+00 ✓) :
- critère 3 : **5/5 années positives** (2019 +0,21 ; 2020 +1,59 ; 2021
  +1,47 ; 2022 +2,18 ; 2023 +0,18) — la structure « short les pumps de
  volume » est RÉELLE et stable ;
- **critère 4 : MORT — coûts ×2 → Sharpe +0,18** (< 0,5) : le z-vol churne
  le quintile en continu, ~85 % du brut part en frais à ×1 ; aucune marge
  de sécurité sur les frais réels.
- **OOS JAMAIS consommé** (arrêt avant, comme conçu) — préservé si un jour
  une exécution maker/turnover réduit se justifie (ce serait un NOUVEAU
  protocole, pas un rattrapage de celui-ci).
Même catégorie que LOWVOL (H1) : « facteur réel, inexploitable à nos
contraintes ». Cohérent avec listing2 : les pumps SE shortent — mais par
ÉVÉNEMENT daté (listing, funding extrême), pas par churn de quintile.
