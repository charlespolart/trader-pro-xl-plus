# venue2 — réplication du signal regime1 sur funding BYBIT (N3, protocole pré-enregistré)

**Ouvert le 2026-07-17, committé AVANT toute exécution.** But : robustesse
EXTERNE du candidat n°1 — si la porte/sélection ne fonctionnent que sur le
funding Binance précisément, c'est un artefact de venue ; si le facteur est
réel, le funding Bybit (venue au funding historiquement le plus riche, R3
carry1) doit porter le même signal. NOTE : l'API Bybit directe est
GÉO-BLOQUÉE (CloudFront) → source = Coinalyze venue `.6` (funding daily,
profondeur 2020→, machinerie venue1 éprouvée, unités POURCENTS ÷100).

## Définition (FIGÉE — une seule variante jugée)

G2,5/C3 du candidat, STRICTEMENT inchangé, avec pour SEUL changement la
SOURCE du signal : porte = médiane du funding quotidien BYBIT des éligibles
≥ 2,5 bps/j ; sélection = quintile funding-max BYBIT (FLEVEL L3 sur le
funding Bybit) ; éligibilité observable identique (≥ 21 j vus, dernier
< 48 h — sur les données Bybit). EXÉCUTION inchangée : prix perps Binance
(proxy validé V2 : corr 1,000) + funding BINANCE encaissé (la structure
déployable : seul le signal devient multi-venue). Univers : perps Bybit
USDT ∩ univers spot (matching par nom, mêmes règles).

## Barre (réplication, pas une recherche)

IS 2020-07→2024-01 et OOS 2024-01→2026-07, mêmes fenêtres. **Barre : même
signe, Sharpe OOS ≥ 0,8 (≈ 50 % du +1,62 du candidat), épisodes
majoritairement positifs.** Si ça casse → red flag « signal fragile à la
venue » dans la fiche (pas une invalidation du candidat Binance, mais une
alerte de robustesse à consigner).

## Journal

- 2026-07-17 : protocole écrit et committé avant exécution.

## VERDICT (2026-07-17) : ✓ ROBUSTESSE EXTERNE CONFIRMÉE — barre passée

Couverture 315/564 colonnes (les perps Bybit ∩ univers). Signal 100 % Bybit
(porte + sélection + éligibilité), exécution Binance inchangée :
- IS : Sharpe +0,84, +33,2 %/an, Calmar 1,04, ON 54,7 % (porte plus lisse
  que Binance : funding Bybit plus riche → épisodes fusionnés 2/2) ;
- **OOS : Sharpe +1,42 (88 % du +1,62 du candidat), +70,4 %/an, DD 35 %,
  Calmar 2,01, ép 3/4 → BARRE PASSÉE** (même signe, ≥ 0,8, majorité).
- p permutation 0,90/0,48 : attendu — teste la sélection intra-porte (pas
  la source de l'edge, cf. 8c) ; la barre de réplication est le Sharpe.
**Le facteur regime1 n'est PAS un artefact de la venue Binance** : la même
mécanique, signal reconstruit sur une venue indépendante (via Coinalyze),
reproduit l'essentiel de l'OOS. Renfort de robustesse pour la fiche +
option de design : porte multi-venue (médiane des médianes) notée pour la
démo.
