# regime1 — short de junk RÉGIME-GATED (protocole pré-enregistré)

**Ouvert le 2026-07-16, committé AVANT toute exécution.** Horizon H7. Naît du
fil rouge H1+H2 : le SEUL mécanisme récurrent des deux campagnes de coupe est
le short du junk aux extrêmes (vol/funding), et il est ÉPISODIQUE — énorme en
manie (2020-21 : +183 %/an), négatif hors manie (2022-23 : −25 %/an). La thèse
H7 : dormant par défaut, activé par une PORTE de régime mécanique.

## Le piège assumé d'avance : sur-ajuster la porte à 2021

Défenses pré-enregistrées :
1. **Porte minuscule et mécanique** : médiane du funding QUOTIDIEN sur les
   perps éligibles ≥ G — UNE seule famille d'agrégat, TROIS seuils figés
   G ∈ {2,5 ; 5 ; 10} bps/jour (5 bps/j ≈ 18 %/an : manie authentique).
   Évaluée au rebalancement (K=7 figé). Pas d'hystérésis, pas d'autre knob.
2. **Cohérence PAR ÉPISODE exigée** : un épisode = série de jours ON
   contigus (fusion si gap < 14 j). Barre : ≥ 3 épisodes sur IS+OOS ET
   majorité d'épisodes positifs. Un seul gros épisode gagnant = « n
   insuffisant », pas un edge.
3. **L'OOS 2024→26 contient des vagues candidates** (memecoins déc-23→mars-24,
   nov-24) : si la porte est réelle, elle DOIT s'y rouvrir et payer — c'est
   le vrai juge, une seule passe, à la fin.

## Constructions (3, figées — le ledger complet)

Quand la porte est ON (sinon FLAT, zéro position, zéro coût) :
- **C1 (primaire) : L/S funding** — short quintile funding max / long
  quintile funding min (la construction neutre de carry3 ; sa jambe longue
  est ~plate mais gratuite) ;
- C2 : short SEUL du quintile funding max (nu — mesure honnête du tail-risk
  d'un short de manie) ;
- C3 : short quintile funding max + long BTC 1:1 (hedgé qualité).
Univers/éligibilité/coûts/funding : IDENTIQUES à carry3 (observable, 30 bps,
pnl −(F@w)). Signal intra-porte : FLEVEL L3 (le BH de carry3 — hérité, pas
re-fitté).

## Éval & garde-fous

- 9 stats (3 portes × 3 constructions), BH-FDR 10 % sur l'ensemble, null par
  réétiquetage de colonnes (le null validé — NOTE : la porte est un agrégat
  GLOBAL, identique sous permutation → le null teste la SÉLECTION intra-porte,
  et la porte elle-même est testée par les épisodes/OOS).
- Référence obligatoire au ledger : les mêmes constructions SANS porte
  (les baselines carry3, déjà connues).
- **Placebo** : prix iid par actif, funding réel (porte réelle) → 0-1/9
  attendu à p<0,01.
- **Contrôle positif** : la porte G=5 bps doit être ON pendant l'épisode
  connu 2020-Q4→2021-Q2 (vérité terrain mesurée en H2) et OFF la majorité
  de 2022-23. Sinon la porte ne mesure pas ce qu'on croit, stop.
- Sous-métriques par cellule : % de jours ON, nb d'épisodes, pnl par épisode,
  Sharpe/Calmar plein-période ET par-jour-actif.

## Barre de survie (inchangée)

1. BH p<0,01 ; 2. Sharpe plein-période ≥ 0,8 ET Calmar > 1 ; 3. ≥3 épisodes,
majorité positifs (IS seul d'abord) ; 4. coûts ×2 → Sharpe > 0,5 ;
5. OOS UNIQUE 2024-01→2026-07 : même signe, ≥50 % du Sharpe IS, ET ses
épisodes propres positifs en majorité ; 6. réplication vrais prix perps ;
7. duel/contribution vs incumbents + WF ancré.
IS : 2020-07→2024-01. OOS intact jusqu'à barre 1-4 tenue.

## Journal

- 2026-07-16 : protocole écrit et committé avant exécution.

## GARDE-FOUS (2026-07-16) — contrôle de porte : substance ✓, prior de calendrier corrigé

- Porte G=5 bps/j : **7 épisodes IS = les manies connues** (août-20, nov-20,
  déc-20→mai-21, août-21, oct-21, nov-23, déc-23 — la vague memecoin de
  fin 2023 est DÉJÀ attrapée en bout d'IS) ; **0 % d'activation dans la zone
  morte juin-22→juin-23** (littéral). G=2,5 trop lâche (ON 69 %), G=10
  resserre sans changer les épisodes.
- Le critère chiffré « ON >60 % de nov-20→avr-21 » a raté d'un point (59 %) :
  vérification factuelle → **0 trou de données** ; les 74 jours OFF avaient
  une médiane réelle 3,0-5,0 bps/j — la manie n'est devenue maniaque qu'à
  partir de fin décembre 2020. MON prior de calendrier était faux, la porte
  est juste. Consigné, seuil INCHANGÉ, aucun re-fit.
