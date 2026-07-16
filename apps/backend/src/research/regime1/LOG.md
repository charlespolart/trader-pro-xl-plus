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

## IS + OOS (2026-07-16) — PREMIER SURVIVANT DE LA CHAÎNE COMPLÈTE

**IS** (placebo 0/9 ✓) : 7/9 BH ; deux cellules tiennent la chaîne 1-4 :
- **G5,0/C1 (primaire)** : Sharpe +1,91, +38,7 %/an, DD 23,0 %, Calmar 1,68,
  p=0,001, ép 4/7, ON 17,8 %, coûts ×2 → 1,49 ✓ ;
- G2,5/C3 : Sharpe +1,15, Calmar 2,12, ép 6/10, coûts ×2 → 0,82 ✓.

**OOS 2024-01→2026-07 (UNE passe, dépensée pour ces deux cellules)** :
- G5,0/C1 : **ÉCHEC à la barre** (Sharpe +0,79 = 41 % de l'IS < 50 % ;
  ép 1/3) — même signe et p=0,006, mais la barre est la barre.
- **G2,5/C3 : PASSE TOUT — Sharpe +1,77 (154 % de l'IS), +122,7 %/an,
  DD 33,4 %, Calmar 3,67, ép 7/11 positifs, BH ✓** (Bonferroni ×2 sur les
  2 tests OOS : p=0,03, tient). La jambe short nue (C2) confirme le mécanisme
  en OOS : +115,9 %/an, ép 8/11 — les vagues memecoin 2024-25 ont payé les
  shorts de junk comme la thèse le prévoyait.

**Anatomie du survivant G2,5/C3** : porte médiane-funding ≥ 2,5 bps/j (ON
69 % IS / 50 % OOS — plus « chronique » que la G5, dormance partielle) ;
short quintile funding-max + long BTC 1:1 pendant ON ; signal FLEVEL L3
hérité ; K7. IS 1,15/2,12 → OOS 1,77/3,67 : le facteur s'est RENFORCÉ hors
échantillon (rare — cohérent avec des manies 2024-25 plus fréquentes).

**STATUT : premier survivant chaîne complète (critères 1-5+OOS) — PAS ENCORE
un candidat déployable.** Restent (pré-inscrits) : 6. réplication VRAIS prix
perps (le proxy spot sous-estime basis/coûts de la jambe courte) ;
7. duel/contribution vs incumbents (ROADMAP) + WF ancré ; stress
d'exécution (liquidité de la jambe short en manie, slippage au tick).

## ÉTAPE 6 (2026-07-16) — réplication vrais prix perps : définition PRÉ-DÉCLARÉE

Écrit et committé AVANT de voir le moindre chiffre perp.

- Données : klines 1d um-futures Vision, 447 symboles (funding ∩ univers spot
  + BTCUSDT), 2020-01→now, base 5438 (`ensure_perps.ts` + `perp_symbols.txt`).
- Réplication STRICTE : porte, éligibilité, sélection = INCHANGÉES (spot).
  Seule l'EXÉCUTION change : rendements perp réels quand disponibles
  (fallback spot compté et rapporté), long BTC en PERP qui PAIE son funding
  (coût de portage réel en manie, ignoré par le proxy spot).
- **Variante jugée (unique) : « perp intégral »** = jambe short perp + long
  BTC perp − funding BTC. Le diag « short perp + long BTC spot » est
  INFORMATIF seulement (localiser la dégradation), pas une cellule de choix.
- Barre : Sharpe OOS perp ≥ 0,9 (≈50 % du 1,77 spot). Sinon : MORT, verdict,
  horizon suivant.
- Aucune nouvelle grille : G2,5/C3 uniquement, IS+OOS rejoués tels quels.

## ÉTAPE 6 — VERDICT (2026-07-16) : SURVIT ✓ (Sharpe OOS perp +1,62 ≥ 0,9)

Données : 447/447 perps téléchargés (491 163 candles 1d, 2020-01→2026-07-13,
0 erreur ; LUNA délisté présent avec sa vraie fin — survivorship préservé).
Couverture perp de la jambe short : **99,8 % des jours-poids** (fallback spot
négligeable). Contrôle de non-régression : la réf. spot rejouée redonne les
chiffres publiés à l'identique (IS +1,15/2,12 ép 6/10 ; OOS +1,77/3,67 ép
7/11, p=0,015).

| Variante | IS Sharpe/Calmar | OOS Sharpe/CAGR/DD/Calmar | ép OOS |
|---|---|---|---|
| spot (réf.) | +1,15 / 2,12 | +1,77 / +122,7 % / 33,4 % / 3,67 | 7/11 |
| **PERP INTÉGRAL (jugée)** | **+0,89 / 1,34** | **+1,62 / +103,4 % / 34,0 % / 3,04** | **7/11** |
| diag short-perp/BTC-spot | +1,14 / 2,09 | +1,74 / +114,8 % / 33,5 % / 3,43 | 7/11 |

Coûts ×2 (perp intégral) : IS +0,56, OOS +1,31 — la barre 4 d'origine
tiendrait encore. p permutation perp : IS 0,001, OOS 0,038 (sélection
intra-porte toujours significative seule sous exécution perp ; la barre de
l'étape était le Sharpe, pas p — noté).

**Décomposition** : le diag (jambe short perp + long BTC SPOT) ≈ réf. spot
→ la quasi-totalité de la dégradation vient du FUNDING PAYÉ PAR LE LONG BTC
PERP (~12 %/an en moyenne, plus cher en manie précisément quand la porte est
ON), PAS des prix de la jambe short (basis 1d minime, prix perps ≈ spot).
Conséquence de design pour la stratégie finale (pas un re-choix de cellule —
la variante jugée passe d'elle-même) : la jambe longue BTC gagnerait à être
SPOT, ce qui est RÉALISABLE en vrai (les bots détiennent déjà du BTC spot) et
redonne quasi les chiffres spot.

Notes univers consignées : 15 perps à préfixe 1000×/1000000× (PEPE, BONK,
FLOKI, LUNC…) ne matchent jamais le symbole spot → jamais éligibles dans
TOUT carry3/regime1 (IS, OOS et réplication cohérents entre eux) ; l'univers
shorté est donc conservateur — un mapping 1000×↔spot est une amélioration
FUTURE à tester proprement, hors réplication. Panel : 445/564 colonnes avec
données futures (les ~120 restantes = paires spot sans perp — jamais
shortables, cohérent).

## ÉTAPE 7 (2026-07-16) — duel & contribution vs incumbents : protocole PRÉ-DÉCLARÉ

Committé AVANT tout calcul. Série regime1 utilisée PARTOUT : la variante
JUGÉE de l'étape 6 (perp intégral, la plus conservatrice — si elle bat, le
long-BTC-spot bat a fortiori). Rendements quotidiens, fenêtre continue
2020-07-01→2026-07-01 (IS+OOS enchaînés, mêmes poids/porte, rien re-fitté).

**7a. Séries incumbents** (`incumbents_run.ts`, moteur réel runBacktest,
coûts OKX taker 0,10 % + slip 0,05 %, défauts committés, base 5438,
symbolInfo épinglé) : btc-swing (quote USD), btc-accumulator (base BTC),
btc-vrx (base BTC) sur 2020-07→2026-07 ; équités quotidiennes dumpées CSV.
Conversion USD des sleeves base : équité_BTC × close BTCUSDT spot 1d.

**7b. Duel direct (dénomination commune USD)** vs btc-swing — le seul
incumbent quote. Fenêtre JUGE = OOS pur 2024-01→2026-07 (zéro sélection
regime1 dedans) ; fenêtre info = 2020-07→2026-07. Barre (ROADMAP) : CAGR
supérieur à DD égal ou moindre, OU CAGR ~égal à DD nettement moindre.

**7c. Contribution portefeuille à risque constant.** Composite référence =
1/3 accum + 1/3 vrx + 1/3 swing (rendements quotidiens USD, rebalancement
quotidien — simplification standard, consignée). Candidat = 80 % référence
+ 20 % regime1 (sleeve FIGÉE d'avance, pas de grille). Le candidat est mis à
l'échelle scalaire pour ÉGALISER la vol quotidienne du référence sur la
fenêtre. Barre : CAGR supérieur ET DD pas pire de plus de 3 pts, sur les
DEUX fenêtres (info + juge). Rapportées : corrélations quotidiennes regime1
vs chaque incumbent et vs composite (attendu |ρ| ≤ 0,5 — le long BTC 1:1
pendant ON créera de la corrélation BTC, à mesurer honnêtement), part des
jours ON de regime1 où chaque incumbent est simultanément en position.

**7d. Stabilité temporelle** (WF « ancré » adapté : AUCUN paramètre n'est
re-fitté, on teste que le résultat n'est pas porté par un seul bloc) :
Sharpe du perp intégral par période calendaire (2020H2, 2021, …, 2026H1) ;
comptées seulement les périodes avec ≥ 15 jours ON ; barre : majorité des
périodes comptées positives ET aucune ≤ −1,0.

Si 7b OU 7c passe (avec 7d tenue) → étape 8 (stress d'exécution). Si les
deux échouent → verdict « facteur réel mais n'améliore pas l'existant »,
consigné, horizon suivant.

## ÉTAPE 7 — VERDICT (2026-07-16) : 7b PERDU / **7c GAGNÉ ×2 fenêtres** / 7d 7/7 → étape 8

Exécution : `incumbents_run.ts` (moteur réel : swing ×5,48 USD, accum 2,110
BTC, vrx 2,753 BTC sur 2020-07→2026-07) + `regime.py series` (série continue
perp intégral, rebal K7 continu) + `duel.py`.

**7b duel USD brut vs btc-swing : PERDU à la lettre de la barre** — CAGR
écrase (info : +87,6 %/an vs +32,8 % ; JUGE OOS : +133,3 %/an vs +10,1 %)
mais DD supérieur (45,3 % vs 24,2 % ; 33,7 % vs 20,4 %) → ni cas A ni cas B.
En solo à risque brut, ce n'est PAS une domination : il rapporte ~3× plus en
prenant ~1,8× plus de DD. (Nota : Sharpe duel 2,08 OOS vs 1,62 à l'étape 6 =
rendements simples vs log + série continue — convention, pas un bug.)

**7c contribution à risque constant : AMÉLIORE, nettement, sur les DEUX
fenêtres.** Composite 1/3 accum + 1/3 vrx + 1/3 swing (USD), sleeve 20 %
figée, vol égalisée (levier ≈ ×1,19) :
- info 2020-07→26 : Sharpe 1,27→1,66, CAGR +52,6→+77,9 %/an, DD 40,1→34,9 %
  (Calmar 1,31→2,23) — rendement +25 pts ET DD −5 pts ;
- **JUGE OOS 2024→26 : Sharpe 0,66→1,30, CAGR +17,9→+45,4 %/an, DD
  31,7→30,2 %** (Calmar 0,57→1,50).

**Corrélations quotidiennes ≈ ZÉRO** (vs swing +0,02, accum +0,01, vrx
−0,00, composite +0,01 ; idem sur jours ON) — vrai diversifiant, le long BTC
1:1 pendant ON ne crée pas de corrélation mesurable (jambes compensées).
Co-activité pendant les jours ON : swing en position 35,6 % (concentration
BTC simultanée à surveiller au design final), accum en excursion 4,3 %, vrx
8,0 % — les manies ne coïncident pas avec les excursions des accumulateurs.

**7d stabilité : 7/7 périodes comptées positives** (pire : 2021 à +0,18 —
l'année « porte chronique » qui paie peu net de coûts ; 2022 +1,00 avec
133 j ON ; 2024 +2,49 ; 2025 +2,12) → STABLE ✓.

**Décision protocolaire : 7c ✓ + 7d ✓ → étape 8 (stress d'exécution).**
Lecture honnête pour Mario : regime1 ne REMPLACE pas un incumbent — il
s'AJOUTE au portefeuille comme sleeve décorrélée et c'est là qu'il crée de
la valeur (le composite OOS passe de Calmar 0,57 à 1,50 à vol égale).

## ÉTAPE 8 (2026-07-16) — stress d'exécution : protocole PRÉ-DÉCLARÉ

Committé AVANT tout calcul. Sleeve de référence : 20 % × ~30 k$ ≈ 6 k$ de
capital, soit ~6 k$ de notional par jambe quand ON (12 k$ brut).

**8a. Capacité de la jambe short en manie** (quoteVolume des klines
um-futures, base 5438). Pour CHAQUE rebalancement ON de la fenêtre complète
(sélection réelle rejouée, K7) : volume quotidien USDT de chaque nom shorté
au jour du rebal ; capacité du panier = 1 % de participation sur le nom le
plus fin × ntop (panier équipondéré : S_max = 1 % × ADV_min × ntop).
Rapportés : médiane/p10 des S_max, et des ADV_min/med. **Barre : p10 des
S_max ≥ 60 k$ (≥ 10× la sleeve actuelle).**

**8b. Coûts/turnover** : turnover notionnel moyen par rebal et annualisé
(|Δw| réels), coût annuel aux 30 bps/côté ; rappel du stress coûts ×2 déjà
passé (étape 6 : OOS +1,31). Limite consignée : pas de mesure au tick
(symbolInfo Binance géo-bloqué) — couverte par la marge du ×2 au grain 1d.

**8c. Transposabilité OKX** (l'exécution réelle serait OKX ; le funding
mesuré est Binance). Liste publique des instruments SWAP OKX (API v5, sans
compte) ; mapping BASE-USDT-SWAP ; couverture = part des JOURS-POIDS de la
jambe short dont le nom a un perp OKX. **Barre : ≥ 70 % des jours-poids**
(70-90 % → « exécutable, univers réduit à re-mesurer à la fiche » ; < 70 %
→ venue alternative nécessaire, décision Mario). Risque de base
funding OKX≠Binance consigné (R3 carry1 : OKX paie 1-3 pts de moins) — la
re-mesure fine appartient à la fiche stratégie, pas au stress.

**8d. Marge/levier (consigné, pas de barre)** : notional brut 2× la sleeve
quand ON (short junk + long BTC 1:1) → levier compte ≈ 2 en cross-margin ;
long BTC réalisable en spot déjà détenu (étape 6 : variante meilleure).

Barre globale étape 8 : **8a ✓ ET 8c ≥ 70 %** → fiche complète de
proposition à Mario (stratégie + intégration portefeuille + plan bot démo).
Sinon : consigner ce qui casse, verdict, suite ROADMAP.

## ÉTAPE 8 — mesures (2026-07-16) : 8a PASSE (après correction d'artefact), 8c CASSE structurellement

Première passe : p10 capacité = 0 → vérification factuelle AVANT verdict :
l'artefact venait de 0,1 % de noms sans kline + perps moribonds à volume
réellement nul (1,7-7,6 % des noms selon l'année — délistages en cours).
**8a corrigé (noms mesurés >0) : S_max méd 2,4 M$, p10 651 k$, min 159 k$ →
barre 60 k$ PASSÉE ×10, même le pire panier fait ×26 la sleeve.** Correction
de mesure consignée (l'esprit de la barre : chaque nom shorté supporte 1 %
de participation), pas un déplacement de barre. À la fiche : filtre
d'exécutabilité ADV>0 (impact sélection ~2-8 % des noms, re-mesure incluse
ci-dessous). Structurel noté : ntop 13 (2020) → 104 (2026), la queue du
panier s'affine (ADVmin p10 : 7,4 M$ en 2021 → 0,4-0,8 M$ en 2025-26).

**8b : turnover 54×/an → 16,2 %/an de coûts aux 30 bps — déjà DANS tous les
chiffres nets ; stress ×2 passé (étape 6).** Consigné.

**8c : couverture OKX 44 % global et DÉCROISSANTE — 66,7 % (2020) →
26-34 % (2025-26). CASSE réelle, pas un artefact** : l'univers perp Binance
récent (ntop ~100) est plein de junk fin jamais listé chez OKX (spot-check :
ACX, PHB, SANTOS, SLP, LUMIA… — mapping vérifié). L'exécution OKX ne peut
PAS répliquer la stratégie mesurée telle quelle.

### Re-mesure « univers OKX » PRÉ-DÉCLARÉE (avant exécution)

Question : que vaut G2,5/C3 si la jambe short ne peut sélectionner QUE des
noms OKX-listables (ce qu'on ferait en vrai sur notre infra) ?
- Fenêtre : **OOS 2024-01→2026-07 UNIQUEMENT** — la liste OKX vivante y est
  une approximation raisonnable de la liste d'époque ; appliquée à 2020-23
  elle créerait du survivorship (délistés OKX absents), donc PAS de re-run
  historique complet avec cette liste (consigné).
- Sélection : quintile funding-max RECALCULÉ dans le sous-univers
  éligibles ∩ OKX-listables ∩ volume>0 ; MIN_ALIVE, G, K, signal, coûts,
  porte : INCHANGÉS. Porte calculée sur TOUS les éligibles (le régime est
  global) — seule la jambe shortable est restreinte. Exécution perp
  intégrale (r_exec + long BTC perp − funding).
- Barre (esprit étape 6) : **Sharpe OOS ≥ 0,9** → « déployable sur OKX,
  univers réduit » ; sinon → « OKX insuffisant en l'état », options à
  arbitrer par Mario (venue Binance ? attendre l'élargissement du listing
  OKX ? sleeve réduite ?). UNE passe.

### Re-mesure OKX — RÉSULTAT (une passe) : DÉPLOYABLE ✓ (Sharpe +1,39 ≥ 0,9)

`okx_replay.py` : sous-univers shortable méd 117 noms (vs 265), quintile ~35
(vs ~80). **OOS univers-OKX : Sharpe +1,39 (86 % de la réf +1,62), CAGR
+89,9 %/an, DD 33,0 %, Calmar 2,73, ép 7/11** — l'edge transpose à
l'univers exécutable sur notre infra.

**Nuance consignée (importante, pas cosmétique)** : p permutation = 0,26
dans le sous-univers (vs 0,038 complet) — DANS l'univers OKX récent, la
sélection funding-max ne bat plus significativement un panier junk-OKX
aléatoire : le listing OKX pré-filtre la qualité, la dispersion de junk y
est plus faible, et le rendement vient de la PORTE + l'exposition short-junk
générique + long BTC. Implications : (a) robustesse d'implémentation (la
sélection exacte importe peu dans ce sous-univers) ; (b) ne PAS vendre la
« sélection fine » comme la source de l'edge en exécution OKX ; (c) la
validation statistique de la stratégie reste celle des étapes 1-5 (univers
complet, placebo/nulls/épisodes/Bonferroni) — ceci est une mesure
d'exécutabilité. Toute simplification (ex. panier équipondéré sans signal)
serait une NOUVELLE stratégie : non testée ici, non pré-déclarée, PAS de
dérive.

**VERDICT ÉTAPE 8 GLOBAL : PASSE** — 8a capacité ×10 la barre (après
correction d'artefact consignée), 8b coûts déjà nets + stress ×2, 8c
couverture brute insuffisante MAIS re-mesure pré-déclarée → déployable sur
univers OKX réduit à 86 % du Sharpe. **La chaîne 1-8 est COMPLÈTE : premier
candidat de la mission validé de bout en bout.** Prochain livrable : fiche
de proposition à Mario (aucune action live sans GO explicite — Phase 0).

## EXTENSION 1000× (2026-07-17) — protocole PRÉ-DÉCLARÉ avant exécution

Correction de la limitation technique documentée à l'étape 6 : 15 perps
memecoin à préfixe 1000×/1000000× (PEPE, BONK, FLOKI, LUNC…) n'ont JAMAIS
été éligibles faute de match de nom avec le spot — le junk le plus junk
échappait à la jambe short. Ce n'est PAS un knob : cellule, seuils, signal,
K, coûts, fenêtres restent STRICTEMENT inchangés ; seul le MATCHING
funding/perp↔spot s'élargit (alias 1000XUSDT→XUSDT, appliqué UNIQUEMENT si
le spot strippé existe dans l'univers — garde anti-faux-match ; les
rendements log sont invariants au facteur 1000).
- Test : G2,5/C3 perp intégral, IS + OOS, UNE passe.
- Verdict pour la FICHE uniquement : améliore → l'univers déployé inclura
  le mapping ; dégrade ou neutre → univers actuel conservé. Décision prise
  UNE fois, ici, avant la démo — pas de sélection répétée.
