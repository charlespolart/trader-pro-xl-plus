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
