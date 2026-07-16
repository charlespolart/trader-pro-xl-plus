# saison1 — saisonnalités intraday 24/7 (H3, protocole pré-enregistré)

**Ouvert le 2026-07-16, committé AVANT toute exécution.** H3 ROADMAP : heure
du jour, jour de semaine, fenêtres de funding 00/08/16 UTC, sessions.
Prior : effets documentés dans la littérature mais FINS — l'issue la plus
probable est « structure réelle mais morte après frais taker ». On veut un
verdict rapide, propre, chiffré.

## Données

- Klines 1h spot BTCUSDT + ETHUSDT (déjà en base 5438, 2017-08→now).
  Univers alts 1h : seulement SI un signal survit sur BTC/ETH (téléchargement
  massif sinon injustifié).
- Événements de funding 8h bruts : table perp_funding (base dev 5436) pour
  F3 — à vérifier/extraire vers CSV local (lecture seule de la dev).
- Fenêtres : IS 2018-01→2024-01, OOS 2024-01→2026-07 (une passe, à la fin,
  seulement pour ce qui tient l'IS).

## Familles (grille FIGÉE — 4 familles, pas d'extension sans re-commit)

- **F1 heure-du-jour** : rendement close-to-close par heure UTC (24
  cellules × {BTC, ETH}). Stat : moyenne par cellule + stratégie « long la
  meilleure heure / short la pire » (définies sur IS pair, testées sur IS
  impair — split interne AVANT tout OOS).
- **F2 jour-de-semaine** : 7 cellules, même machinerie (weekend effect).
- **F3 fenêtres de funding** : rendement des heures [h−1, h+1] autour de
  00/08/16 UTC conditionné au SIGNE du funding courant du perp (thèse :
  pression de re-balancement pré-règlement). BTC + ETH perp funding réel.
- **F4 sessions** : Asie 00-08 / EU 07-16 / US 13-22 UTC : moyenne du
  rendement de session + overnight-vs-intrasession.

## Éval & garde-fous

- **Null : permutation de BLOCS JOURNALIERS entiers** (préserve
  l'autocorrélation intra-jour, casse l'alignement calendaire) — percentile
  ≥95 exigé par cellule retenue ; BH-FDR 10 % PAR FAMILLE sur les cellules.
- **Placebo** : mêmes pipelines sur séries décalées d'un offset horaire
  aléatoire ∉ multiples de 24 h → ~1 % de faux positifs attendus à p<0,01.
- **Contrôle positif** : le règlement de funding 8h doit être RETROUVABLE
  dans la basis perp−spot autour des fenêtres 00/08/16 (effet mécanique
  connu). S'il ne l'est pas, la machinerie ne voit rien → stop.
- **Barre d'exploitation** : tout effet retenu doit rester >0 net de
  30 bps/côté au grain de trading impliqué (une entrée+sortie par
  occurrence = 60 bps/cycle !) ; sinon verdict « réel mais non exploitable
  en taker » (l'angle maker est noté, pas exploré — infra différente).
- Stabilité par année ; règle du trop-beau ; ledger de tout essai ;
  OOS unique à la fin.

## Amendement pré-exécution (2026-07-16, AVANT tout calcul)

Le null « permutation de blocs journaliers » est INOPÉRANT pour F1 :
l'étiquette d'heure survit à une permutation de l'ordre des jours. Null
UNIFIÉ pour toutes les familles : **décalage circulaire global de k heures**
(k aléatoire uniforme, k mod période ≠ 0 — période 24 h pour F1/F3/F4,
168 h pour F2), 1000 tirages — préserve TOUTE l'autocorrélation de la
série, casse uniquement l'alignement calendaire. Placebo : pipeline complet
sur rendements iid-shufflés (~1 % de faux positifs attendus à p<0,01).

## Amendement 2 — ATTRAPÉ PAR LE PLACEBO (2026-07-16, avant toute conclusion)

Premier run placebo : 2/62 cellules BH à p=0,001 sur du bruit iid → null
INVALIDE. Cause : le décalage « k heures mod période » n'a que 23 valeurs
distinctes pour F1 (167 pour F2) — résolution de p ≈ 1/24, incompatible
avec BH 10 % sur 24 cellules (toute cellule extrême sort p=0,001
artificiel). Les cellules « significatives » du premier run réel ont la
même signature que le placebo : AUCUNE conclusion n'en est tirée.
**Correction : rotation circulaire du VECTEUR de rendements entier
(np.roll de k ∈ [24, n−24], k mod période ≠ 0 → ~52 000 décalages
distincts), étiquettes fixes.** Le placebo doit repasser ~0/62 avant tout
regard sur le réel. (3e attrape du placebo dans la mission : null par rangs
xsection1, contrôles sous-puissants patterns, celui-ci.)

## Journal

- 2026-07-16 : protocole écrit, committé avant exécution.
- 2026-07-16 : amendement du null (ci-dessus) committé avant exécution.
- 2026-07-16 : amendement 2 (null re-corrigé, attrapé par placebo) committé
  avant toute conclusion sur le réel.
