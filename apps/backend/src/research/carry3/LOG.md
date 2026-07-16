# carry3 — facteur FUNDING en coupe (protocole pré-enregistré)

**Ouvert le 2026-07-16, committé AVANT toute exécution.** Horizon H2 de la
ROADMAP. Hérite de xsection1 : panel univers 606 paires (survivorship-safe),
funding quotidien 791 perps Binance (funding_daily_all.csv), pipeline validé
(placebo 0/44, parité 5,6e-17, null par réétiquetage).

## Mécanisme & priors

Le funding est le prix payé par le CÔTÉ SURPEUPLÉ d'un perp. Funding
positivement persistant = longs de junk/memes qui paient ; négatif = shorts
surpeuplés. Le facteur : **L/S en coupe trié par funding — short les funding
hauts (on ENCAISSE leur funding), long les funding bas/négatifs (on encaisse
aussi)** — perps des DEUX côtés → nativement exécutable, le tueur de H1
(borrow du junk) disparaît PAR CONSTRUCTION.

**Preuve d'existence mesurée (H1)** : les shorts de junk ont reçu **+72,9 %
de funding cumulé** sur l'IS — la coupe de funding est grasse.

**Priors maison (honnêteté)** : carry1 a établi la PERSISTANCE du funding
(+0,46) mais a TUÉ la rotation de récolte mono-actif (R1) et le timing (R4) —
objets DIFFÉRENTS du facteur coupe market-neutral testé ici (jamais testé à
la maison). Littérature : facteur funding-carry documenté en crypto.

## Données & approximations ASSUMÉES

- Funding : somme quotidienne par perp (791), Binance, 2020-01→2026-07.
- **Prix des jambes = SPOT en proxy du perp** (base spot-perp ≈ bps au grain
  1d). Assumé pour le dépistage ; **réplication sur VRAIS prix perps (Vision
  um futures) OBLIGATOIRE avant tout statut de candidat** — pré-inscrit.
- **Vie d'un perp = OBSERVABLE uniquement** (leçon H1) : éligible à t si
  ≥21 événements de funding vus ET dernier événement < 48 h avant t. AUCUN
  usage de la date de mort ex-post.
- PnL funding : pnl −= w×F pour TOUT w (long paie F>0, short le reçoit —
  une seule formule, testée au signe près).
- Coûts : 30 bps/côté sur le notionnel tourné (conservateur pour des perps,
  taker réel ~5 bps) ; stress ×2.

## Familles & grilles (FIGÉES)

Signal au close t (funding connu jusqu'à t), poids sur r(t+1), jambes
équipondérées TOPQ 30 %, MIN_ALIVE 30 perps éligibles.

| Famille | Signal | Grille | # |
|---|---|---|---|
| FLEVEL | −(funding cumulé L jours) | L∈{3,7,14,30} × K∈{2,7} | 8 |
| FMOM | −(moy. funding 3 j − moy. funding L jours) | L∈{14,30} × K∈{2,7} | 4 |

24 stats (12 configs × L/S+LO), BH-FDR 10 % par famille sur la primaire.

## Éval, nulls, garde-fous (pré-enregistrés)

- Primaire : Sharpe net (√365) IS ; null = RÉÉTIQUETAGE de colonnes (le null
  validé de xsection1 — préserve persistance/turnover), 1 000 perms.
- **Placebo machinerie** : panel de PRIX mélangé iid par actif (funding réel
  conservé) → tout p<0,01 au-delà de ~1 % = biais, stop. (Le funding réel sur
  prix aléatoires ne doit prédire que sa PROPRE jambe de transfert — le test
  vérifie que la machinerie ne fabrique pas de la convergence fantôme.)
- **Contrôle positif** : la composante FUNDING SEULE du facteur FLEVEL
  (pnl de transfert, prix figés) doit ressortir à p<0,01 — la machinerie doit
  retrouver la coupe de funding CONNUE (mesurée en H1). Sinon stop.
- Quintiles monotones, plateau (L×K voisins ≥50 %), sous-périodes.

## Barre de survie (inchangée, inamovible)

1. BH p<0,01 ; 2. Sharpe ≥ 0,8 ET Calmar > 1 ; 3. quintiles monotones ;
4. plateau ; 5. coûts ×2 → Sharpe > 0,5 ; 6. OOS UNIQUE 2024-01→2026-07
(même signe, ≥50 % du Sharpe IS) ; 7. **réplication vrais prix perps** ;
8. duel/contribution vs incumbents (ROADMAP) + WF ancré.
IS : 2020-07→2024-01 (warmup funding 6 mois).

## Journal

- 2026-07-16 : protocole écrit et committé avant exécution.

## GARDE-FOUS (2026-07-16) — passés du premier coup (pipeline hérité rodé)

- **Contrôle positif** : composante funding SEULE de FLEVEL L7 K7 L/S —
  p=0,002 sous permutation ✓ ; spread BRUT (sans double-compter les coûts,
  qui appartiennent à la stratégie entière) : **+27,0 %/an à Sharpe 17**
  (transfert quasi déterministe). La machinerie retrouve la coupe de funding
  connue. Note d'harnais consignée : la version « avec coûts pleins sur la
  composante seule » donnait Sharpe −0,54 (double comptage) — le critère du
  protocole était p<0,01, tenu.
- **Placebo** (prix iid par actif, funding réel, PnL prix seuls) : 0/24 ✓.
- Éligibilité observable effective : 132 perps médians sur l'IS.

## IS + INSTRUCTION (2026-07-16) — VERDICT H2 : ARTEFACT DE RÉGIME 2020-21

IS 2020-07→2024-01, 24 stats, 1 000 permutations : **3 BH, toutes L/S**
(FLEVEL L3/K7 Sharpe +0,94 Calmar 0,62 p=0,008 ; FMOM L14/K7 +0,60 p=0,002 ;
FMOM L30/K7 +0,75 p=0,001) — toutes sous le critère 2 (mur du Calmar, DD
51-75 % : les jambes prix portent la vol du junk).

**Instruction du meilleur (FLEVEL L3/K7) — fatale :**
- sous-périodes : **2020-07→2022-01 : Sharpe +2,96, +182,8 %/an ; 2022-01→
  2024-01 : Sharpe −1,15, −25,0 %/an** — le facteur est MORT avec la manie
  des memes (compression du funding post-2022, cohérent carry1) ;
- quintiles : seul Q1 (funding max, shorté) porte (−131 bps/7 j) ; la jambe
  LONGUE n'a jamais rien donné (Q5 : +2 bps/7 j).

**VERDICT H2 : « artefact de régime »** — la coupe de funding est réelle et
la machinerie la voit (contrôle +27 %/an brut, 3 BH), mais son expression
L/S n'a payé que pendant la bulle 2020-21 et PERD depuis 2022. Critère 2
jamais tenu, sous-périodes rédhibitoires → **OOS JAMAIS consommé**. Le test
de mélange pré-déclaré (LOWVOL+FUNDING) tombe : on ne blende pas un facteur
mort (il ne pourrait que diluer LOWVOL, lui-même sous-barre).

**Ce qui reste vivant de H1+H2 pour la suite** : (1) le SHORT de junk à
funding/vol extrêmes est le seul mécanisme récurrent (les deux campagnes le
retrouvent) — il alimente H7 (« short de tendance + carry », vierge) avec une
contrainte connue : c'est épisodique (manies) → penser RÉGIME-GATED plutôt
que facteur permanent ; (2) le pipeline coupe (placebo/parité/permutation/
éligibilité observable) est rodé et réutilisable tel quel.
