# oi1 — OPEN INTEREST cross-section (E1, protocole pré-enregistré)

**Ouvert le 2026-07-17, committé AVANT toute exécution.** Jamais testé en
coupe chez nous (accum6 = OI en FLUX intraday BTC/ETH, ⛔). Thèse : l'OI
mesure le STOCK de levier par actif — un OI qui gonfle vite (crowding
entrant) ou un stock disproportionné au flux (OI/volume) marque une
fragilité → prédictif cross-section. Direction NON présumée (signe libre,
lecture zvol1 : les deux directions comptées dans le BH).

## Données

OI quotidien par perp, venue Binance (.A), via Coinalyze
(open-interest-history, interval daily, close ; profondeur 2020→) — ~450
perps ∩ univers, cache CSV. Prix : panel univers en base.

## Signaux (FIGÉS — 2, aucun autre lookback)

- **OI-MOM** : Δlog(OI) sur 7 j (croissance du stock de levier).
- **OI-REL** : z-score expansif 90 j de log(OI / dollar-volume 30 j)
  (stock de levier relatif au flux).
- Machinerie xsection réutilisée : quintiles TOPQ 0,30, **K7 uniquement**
  (leçon zvol1 : K2 meurt toujours aux coûts), LO + LS → **4 cellules**,
  BH-FDR 10 % (8 si lecture miroir déclenchée — cumulées).

## Garde-fous (chaîne standard + leçons de la mission)

- Placebo : OI iid-shufflé par colonne (prix réels) → ~1 % à p<0,01.
- Contrôle planté : fuite t+1 → explose (validé leadlag/zvol).
- Null : réétiquetage de colonnes. **Critère 4 (coûts ×2, portfolio_cm
  parité exigée) évalué AVANT tout OOS** (leçon zvol1).
- IS 2020-07→2024-01 (profondeur OI) ; OOS 2024-01→2026-07 une passe.

## Journal

- 2026-07-17 : protocole écrit et committé avant exécution.

## Amendement — ATTRAPÉ PAR LE PLACEBO (2026-07-17, avant tout regard sur l'IS)

Placebo OI-iid : 1/4 à p<0,01 (OI-REL LO p=0,005) → STOP. Diagnostic :
OI-REL = z(log(OI×P/ADV)) MÉLANGE l'OI avec le prix et l'ADV RÉELS — le
placebo (qui ne shuffle que l'OI) révèle que la structure survivante vient
de P/ADV, pas de l'open interest. Un signal composite ne teste pas
« l'OI » : tout edge d'OI-REL serait inattribuable. (6e attrape placebo de
la mission — leçon : les ingrédients non testés d'un signal composite
doivent être neutralisés par le placebo, sinon spécifier PUR.)
**Amendement (committé avant lecture de l'IS, qui est jeté)** : OI-REL
RETIRÉ, remplacé par OI-LEVEL = z-exp90 de log(OI_coin) PUR (aucun prix,
aucun volume). Signaux finaux : OI-MOM (Δlog7 OI_coin, pur) + OI-LEVEL
(pur). Re-placebo complet exigé avant IS.

## Amendement 2 — le placebo sonne ENCORE (2026-07-17) : effet d'univers, pas l'OI

Placebo v2 (signaux purs) : OI-LEVEL LO p=0,005 persiste → le mélange
d'ingrédients n'était pas la seule fuite. Diagnostic : « avoir un OI » =
« avoir un perp Binance » = coin établi — le NULL permute les colonnes sur
TOUT l'univers (443 à OI + 121 spot-only), donc les sélections nulles
atterrissent sur des colonnes sans OI/moins établies : le placebo bat le
null par EFFET D'UNIVERS (perp vs pas-perp), pas par l'information OI.
(7e attrape — parente du survivorship MOM de xsection1.)
**Amendement 2 (avant toute lecture d'IS, v2 jetée aussi)** : évaluation
RESTREINTE aux colonnes couvertes par l'OI (le null permute dans le même
univers) ; placebo re-testé ensuite.
