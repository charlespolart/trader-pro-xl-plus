# basis1 — cash-and-carry sur futures DATÉS BTC/ETH (H2-basis, protocole pré-enregistré)

**Ouvert le 2026-07-16, committé AVANT toute exécution.** Le reste vierge de
H2 après carry1 (perp hold : BTC +9,9 %/an net eff., ETH +11,8 % — la
référence à battre) et carry3/H2-coupe (⛔ L/S funding = artefact de
régime). Le DATÉ apporte ce que le perp n'a pas : un taux FIXÉ à l'entrée
et une convergence CERTAINE à l'échéance (pas de risque de compression du
funding en cours de trade).

## Données

48 quarterly Vision um : BTCUSDT_/ETHUSDT_{210326…261225} (klines 1d) +
spot BTC/ETH 1d (en base). Basis annualisée au close :
b(t) = (F_daté(t)/S_spot(t) − 1) × 365/jours_restants.

## Stratégie (FIGÉE)

Par actif (BTC, ETH séparés), une position à la fois :
- **Entrée** : au close du premier jour où le contrat le plus riche a
  b(t) ≥ S, avec S ∈ {5, 10, 15} %/an FIGÉS et 14 ≤ jours restants ≤ 190.
- **Tenue : jusqu'à l'échéance** (convergence mécanique). Long spot + short
  daté même notionnel.
- Rendement du cycle = basis captée à l'entrée − coûts **4 × 30 bps**
  (2 jambes × entrée + sortie — conservateur, même si le règlement
  d'échéance évite une jambe).
- Mark-to-market quotidien rapporté (la basis peut s'élargir → DD du trade
  AVANT convergence — mesuré, c'est LE risque du carry daté avec levier).
- Rendement **net effectif** = sur le capital immobilisé EN CONTINU (les
  jours flat comptent — même convention que carry1).

## Éval

Pas de sélection statistique (arbitrage quasi déterministe) → pas de
BH/nulls ; l'honnêteté = coûts complets, zéro lookahead (entrée au close du
signal), jours flat comptés, DD de basis documenté. **Barre : battre le
carry perp hold de carry1 à risque comparable (BTC +9,9 %/an, ETH
+11,8 %) ; sinon verdict « le perp reste le véhicule », H2 CLOS.**

## Journal

- 2026-07-16 : protocole écrit et committé avant exécution.
