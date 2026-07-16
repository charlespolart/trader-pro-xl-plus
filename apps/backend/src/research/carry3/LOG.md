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
