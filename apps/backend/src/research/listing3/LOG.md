# listing3 — le drift post-listing existe-t-il sur les listings OKX-only ? (N4, protocole pré-enregistré)

**Ouvert le 2026-07-17, committé AVANT toute exécution.** But : élargir le
FLUX D'ÉVÉNEMENTS du candidat n°2 (listing2 short-new-listings, ~34
évts/an jouables). Si le drift post-listing est un fait du MARCHÉ (dilution
de l'attention, vesting, hype decay) et non un artefact Binance, il doit
exister aussi sur les listings OKX — y compris ceux qui ne passent JAMAIS
par Binance (flux additionnel pur).

## Définition (FIGÉE)

- Événements : instruments SWAP OKX avec listTime ∈ [2024-01, 2026-06-01]
  (la liste vivante est fiable sur cette fenêtre récente — même argument
  que la re-mesure 8c). Sous-groupes rapportés séparément : (a) OKX-only
  (base absente de l'univers spot Binance) ; (b) communs (déjà dans
  listing1/2 — contrôle de cohérence).
- Mesure : rendement log J+1→J+30 depuis le premier close OKX (candles 1d
  API), en EXCÈS du panier EW alts Binance (référence de marché — proxy
  inter-venue validé venue1-V2 : corr 1,000).
- Stats robustes moy/méd/trim10 ; **null apparié** : actifs aléatoires
  vivants à la même date dans l'univers Binance (le null validé listing1),
  1000 rééchantillonnages ; percentile bilatéral ≥ 95.
- UNE passe. Si le drift OKX-only tient → note de capacité dans la fiche
  listing2 (flux ~×1,5-2) ; sinon → « le drift est venue-spécifique », la
  fiche reste en l'état.

## Journal

- 2026-07-17 : protocole écrit et committé avant exécution.
