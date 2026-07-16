# pairs1 — stat-arb pairs entre alts corrélés (H8, protocole pré-enregistré)

**Ouvert le 2026-07-16, committé AVANT toute exécution et avant la fin du
téléchargement 1h.** H8 ROADMAP : co-intégration sectorielle. Littérature :
riche 2017-21, décay ensuite ; frais serrés — le handicap est connu
d'avance : en taker, un cycle L/S complet coûte 4 × 30 bps = 1,2 %.

## Données

Univers 1d (606 paires, en base) + 1h (603 paires, téléchargement en fin).
L'estimation (sélection de paires, half-life) peut utiliser le 1h ; le
TRADING est évalué au grain 1d (les cycles taker courts sont morts
d'avance — consigné).

## Design (FIGÉ — walk-forward strict, zéro sélection ex-post)

- **Sélection mensuelle sans lookahead** : au 1er de chaque mois M, parmi
  les coins du top-100 dollar-volume 30 j AVEC perp actif (jambe short
  réaliste) : paires avec corrélation log-returns 1d ≥ 0,8 sur les 180 j
  passés ET half-life AR(1) du spread log ∈ [3, 30] j ; garder les
  20 paires à la half-life la plus nette. Paramètres FIGÉS, aucune grille.
- **Trading mois M+1 (grain 1d)** : z-score du spread (moyenne/σ 60 j
  passés) ; entrée |z| ≥ 2 (long la jambe sous-évaluée, short l'autre,
  0,5/0,5) ; sortie |z| ≤ 0,5 ; stop |z| ≥ 4 ; timeout 30 j. Une position
  max par paire ; capital 1/20 par paire.
- **Coûts** : 4 × 30 bps par cycle + funding réel sur la jambe short (et
  la jambe longue si perp — consigné : les deux jambes en perp, funding
  des deux côtés).
- Fenêtres : IS 2021-01→2024-01 ; OOS 2024-01→2026-07 (une passe si IS
  tient la chaîne).

## Éval & garde-fous

- **Placebo** : pipeline complet sur prix iid-shufflés → ~1 % à p<0,01.
- **Contrôle positif planté** : paire synthétique co-intégrée par
  construction (spread AR(1) simulé de half-life 10 j sur deux colonnes
  réelles) → la machinerie doit la sélectionner ET la trader avec profit
  brut, sinon stop.
- **Null** : mêmes règles de trading sur des paires APPARIÉES aléatoires
  (mêmes dates de sélection, coins aléatoires du même univers éligible) —
  1000 tirages, percentile ≥ 95 du Sharpe agrégé.
- Barre chaîne standard : BH/percentile, Sharpe ≥ 0,8, Calmar > 1,
  coûts ×2 → > 0,5, stabilité par année, OOS ≥ 50 %.
- Sous-métriques : nb de cycles, brut/cycle AVANT coûts (pour voir si
  l'edge existe mais meurt aux frais — l'angle maker serait alors noté).

## Journal

- 2026-07-16 : protocole écrit et committé avant exécution.
- 2026-07-16 : **CONTRÔLE PLANTÉ ÉCHOUÉ (1er essai) → amendements de
  machinerie AVANT tout regard sur le réel** : paire synthétique (hl 10 j)
  trouvée 36 % des mois seulement, Sharpe brut +0,96. Causes diagnostiquées :
  (a) le tri « top-20 par R² AR(1) » est mal calibré — une vraie
  co-intégration hl 10 j a un R² intrinsèque ~3 %, les artefacts l'évincent
  → **tri remplacé par la |t-stat| de β (critère canonique
  Engle-Granger)** ; (b) le retrait mensuel de sélection fermait de force
  les positions ouvertes → **les positions OUVERTES restent gérées par
  leurs règles (z/stop/timeout) même hors sélection ; seule l'ENTRÉE exige
  la sélection**. Barre du contrôle inchangée : trouvée majoritairement +
  Sharpe brut élevé, sinon stop.
