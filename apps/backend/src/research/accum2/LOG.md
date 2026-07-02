# Campagne accumulateur — juillet 2026

**Mission** : (1) confirmer que l'edge de BTC Accumulator v2 est réel (pas de la chance) ;
(2) l'améliorer ou en trouver un autre. Invariant : détenir du BTC, en avoir PLUS à la fin
(dénomination base, benchmark = garder son BTC = 0%). Pas de scalping (timing ≥ 1h, 4h par défaut).

## État des lieux (validé au départ, 2026-07-02)

- **v1** (`btc-accumulator`) : régime = EMA200(1d) < prix ET en déclin 30j, + ER≥0.35 + takerFlow<0.5
  + prix<EMA50(4h) → vend tout ; rachat = recross EMA50(4h) par le haut, stop ATR×2.5 plafonné à 5%.
- **v2** (`btc-accumulator-v2`) : idem, mais tendance sur TF dédié (3d/EMA60/déclin8) + **double
  confirmation** (1d/EMA200/déclin30). Défauts : 2019→2026 +90,5%/-29,2% (53 tr), 2020-08→ +143%/-25%.
- **v3** (`btc-accumulator-v3`) : v2 + `sellFraction` (défaut 0,5). Dial de risque, ratio rendt/DD
  DÉCROÎT quand f baisse → pas un edge, un curseur. Parité f=1 == v2 vérifiée.
- Moteur vérifié (2026-07-02) : event-driven, feeds fusionnés par closeTime, bougies closes
  uniquement, tie-break petit-TF-d'abord → pas de lookahead multi-TF. Warmup par feed dans son
  intervalle (300 bougies 3d = 900j). Parité backtest/live via StrategyRuntime partagé.
- Historique DB : v2 2019→2026 = +90,49%/-29,23%/53tr (backtest UI 2026-06-13) — cible de reproduction.

## Déjà réfuté (mémoire, à re-challenger seulement avec un angle NOUVEAU)

- Mean reversion BTC (toutes variantes taker+maker 15m-4h) ; Fibonacci naïf.
- aggTrades / CVD stratifié baleine : forward ≈ 0, n'ajoute rien au takerFlow candle ;
  ne sépare pas gagnants/whipsaws aux points de vente v2 (|t|<1).
- S/R pivots fractals (cassés 73% en bear), ronds psychologiques, sessions horaires (étude légère).
- rebuyEmaLen=75 : gain concentré sur UNE fenêtre → resté à 50 par défaut (décision utilisateur).
- Ré-optimiser trendInterval en walk-forward : NUIT (sur-ajuste l'IS). TF verrouillé 3d.

## Diagnostic clé hérité (losers.ts) : les pertes sont un problème d'EXIT

Gagnants/perdants IDENTIQUES à l'entrée (ER/flow/vol/profondeur). Corr PnL : max-drop +0.93,
durée +0.81. Perdants = whipsaws rachetés ~9 barres à petite perte ; gagnants tiennent ~70 barres.

## Protocole anti-overfitting (obligatoire pour toute amélioration)

1. **Périodes** : IS = 2019-01→2024-01. OOS = 2024-01→2026-07 (touché par famille de candidats,
   pas par réglage). **2018 (2018-05→2019-01) = pseudo-OOS structurel** : données jamais utilisées
   pour concevoir v1/v2 (backtests historiques démarraient 2019-01). À toucher UNE fois par candidat final.
2. **Plateau obligatoire** : un réglage n'est retenu que si tout son voisinage bat la baseline
   (médiane du voisinage, pas le meilleur point).
3. **Walk-forward** : harnais wfaccumv2.ts (6 fenêtres 2019→2026), params FIGÉS pour le candidat.
4. **Ledger des essais** : compter TOUT ce qui est testé (section Essais ci-dessous) pour garder
   l'ampleur de la recherche en tête au moment du verdict (multiple testing).
5. **Stress** : frais ×2, slippage ×2, décalage de date de départ, déphasage bougies 3d.
6. Étude de séparation AVANT backtest quand possible (réfuter vite, pas d'optimisation prématurée).

## Plan

- [x] 0. Moteur : no-lookahead multi-TF vérifié.
- [ ] 1. Données : spot 4h→2017-08, tout→2026-07 (+ETHUSDT, +funding) — EN COURS.
- [ ] 2. Reproduire baselines v1/v2 (cible : +90,49%/-29,23%/53tr sur 2019→2026-06-13).
- [ ] 3. VALIDATION de l'edge existant :
      a. bear 2018 pseudo-OOS ; b. déphasage 3d (offsets 0/1/2j via resampling 1d) ;
      c. bootstrap trades + baseline « excursions aléatoires en régime bear » (décompose
      régime vs timing) ; d. stress frais/slippage ; e. sensibilité date de départ.
- [ ] 4. AMÉLIORATION exits (le problème diagnostiqué) : trailing buy-stop, ladder de rachat,
      rachat vol-adaptatif, délai minimal — IS d'abord, OOS une fois.
- [ ] 5. AMÉLIORATION filtres : funding perp, percentile ATR, distance ATH, âge du bear.
- [ ] 6. AMÉLIORATION sizing/structure : fraction ∝ profondeur/force, multi-excursions intra-bear.
- [ ] 7. Verdict : WF complet 2018→2026 + holdout, doc HTML, mémoire.

## PHASE VALIDATION — VERDICT (2026-07-02)

### 🔴 Bug de données trouvé et réparé (impacte TOUS les backtests 3d/1w passés)

Les fichiers MENSUELS Vision omettent la bougie multi-jour qui chevauche la fin de mois :
12 bougies 3d isolées manquantes + TOUT janvier 2025 (+ pareil en 1w). Le live (REST/WS)
verrait la série complète → les backtests natifs 3d surestimaient. Réparé par reconstruction
depuis le 1d (`fix3d.sql`, grilles natives 3d ≡1 mod 3, 1w lundi ≡4 mod 7, parité d'agrégation
vérifiée sur les bougies existantes). ⚠ produit : ensureRange recréera des trous sur les
futures queues mensuelles → fix candleStore à faire (tâche dédiée).

### Baselines RÉVISÉES (v2 défauts, données complètes, OKX taker 0,10% + slip 0,05%)

| Fenêtre | AVANT (trouées) | APRÈS (vraies) |
|---|---|---|
| 2019→2026-06 | +85,2% /-29,6% 53tr | **+62,0% /-29,6% 57tr** |
| 2020-08→2026-06 | +143,0% /-25,3% | **+112,5% /-28,0% 49tr** |
| 2024-01→2026-07 | +18,2% | **+4,9%** |
| full 2018-04→2026-07 | — | **+126,2% /-32,5% 65tr** |
| WF OOS 2021→2026 composé | 3d +122% vs v1 +89% | **3d +92,7% (4/6) vs v1 +88,8% (3/6)** |

→ l'edge « 3d bat 1d » est devenu MINCE (+4 pts OOS, +10 pts full). v1 et v2 quasi au coude à coude.

### Ce qui VALIDE l'edge (données complètes partout)

1. **Bear 2018 pseudo-OOS** (jamais utilisé à la conception) : **+46,5%** (prix -59%),
   PF 12,1, DD -14,2%, pire trade -3% — 6 trades, zéro réglage. Fenêtres voisines +30/+35%.
2. **Déphasage 3d** : les 3 phases possibles du calendrier sont positives partout
   (2019→2026 : +62,0/+54,7/+58,8 ; réplique resamplée == native au trade près, prouvé).
3. **Stress coûts** : ×2 → +36,5%/+83,2% ; ×3 → +15,0%/+57,9% (encore positif).
4. **26/26 dates de départ mensuelles positives** (2018-05→2020-06, fin fixe) : min +61,3%.
5. **Null timing-aveugle** : mêmes durées d'excursion, démarrage aléatoire DANS le régime bear
   → médiane **-22%** ; capture parfaite du régime entier : **+11,6%** ; vraie v2 : **+120,4%
   = percentile 97,3**. ⇒ **L'EDGE EST DANS LA MÉCANIQUE D'EXCURSION** (stop -5% cap / exit
   recross rapide / ré-entrée sur faiblesse = couper les rallyes, chevaucher les jambes de
   baisse), PAS dans le filtre de régime (contexte nécessaire, valeur ~nulle seul).
   (Renverse la méta-leçon "edge structurel = régime" de la mémoire sr-research.)

### Ce qui TEMPÈRE

- Bootstrap trades (65) : IC90 [-17,5%, +539%], P(≤0) ≈ 9,6% — part de chance non négligeable,
  rendement porté par la queue droite (payoff 3,5:1, WR 32%).
- 2024→2026 : +4,9% seulement (marché sans vrai bear soutenu — cohérent avec la thèse).
- ETH avec params BTC : NE généralise PAS (+75,6% bear 2018 mais -33% sur 2019→2026, PF 0,7).
- WF fenêtre 2024-08→2025-07 : -11,4% (v1 comme v2 3d).

## Ledger des essais (multiple testing)

| # | Idée | Où | Verdict |
|---|------|----|---------|
| V1-V5 | validation (2018, phase, coûts, départs, null) | oos2018/phase3d/robust/bootstrap_null | edge confirmé, baselines révisées ↓ |
| E1 | min-hold avant recross (6/12/18 barres) | gridexits | ✗ pire (+90..111 vs +115 IS) — transforme micro-pertes en stops |
| E2 | trailing stop pur (k 1.5-3) | gridexits | ✗✗ effondrement (+3..15) — rend k×ATR au rebond, rate les ré-entrées |
| E3 | trail+recross (premier des deux) | gridexits | ✗ (+51..80) — le trail sort plus tôt et plus mal |
| E4 | ladder de rachat (2-4 tranches × 3-8%) | gridexits | ✗ (+16..78), WR 55% mais espérance morte, pire trade -9.9% |
| F1 | filtre funding perp à l'entrée | features_study | ✗ t=1.45, taux ~0 partout, rien |
| F2 | filtre percentile ATR | features_study | ✗ t=-0.29, quartiles non-monotones |
| F3 | filtre distance à l'ATH | features_study | ✗ t=1.18, non-monotone |
| F4 | filtre âge du bear | features_study | ✗ t=-0.22 |
| F5 | heure/jour de semaine (re-check) | features_study | ✗ |t|≤1.34 — confirme NO-GO sessions |
| S1 | sizing ∝ force du signal | par implication de F1-F5 | ✗ rien à l'entrée ne prédit l'issue → scaler = fitter du bruit |
| S2 | cooldown après pertes consécutives | étude sérielle | ✗✗ P(perte|perte)=0.70≈base 0.69, et le trade APRÈS perte rapporte PLUS (+2.15% vs +0.54%) — un cooldown saute les gagnants |
| P1 | plateau tendance (données réparées) 3d×1d×1w | plateau.ts | défauts 3d/60/8 = intérieur d'un plateau sain ; « slow macro » (70-80/8-12, confirm250, 1d/250) +10pts IS |
| P2 | candidats « slow macro » en glissant | wfnudge.ts | ✗ identiques aux défauts 4/6 fenêtres, l'écart IS = 1-2 trades sur 2021 — pas de nudge, défauts confirmés |
| T1 | grain de timing 1h/2h/8h/12h (natif + rescalé) | gridtiming.ts | ✗ 4h domine partout (1h natif : frais 16,7% BTC, PF 1,00 ; 1h rescalé +74 vs +116 ; 8h/12h pires) |

**Synthèse mécanique : les issues des trades sont ~i.i.d. (69% petites pertes ~-2.6%, 31% gains ~+9%),
rien d'observable à l'entrée ou dans l'historique ne prédit le tirage. L'edge EST l'asymétrie
produite par l'exit v2 (recross rapide + stop cappé + ré-entrée). Le cœur v2 est un optimum local.**

## VERDICT FINAL (2026-07-02)

1. **L'edge de la v2 est RÉEL** (2018 OOS +46,5% ; 3 phases 3d positives ; coûts ×3 positif ;
   26/26 départs ; percentile 97,3 vs timing aléatoire) **mais plus modeste que documenté en juin**
   (données trouées) : 2019→2026 +61,9%/-29,6% ; 2020-08→2026 +112,5%/-28% ; full 2018→2026
   +126,2%/-32,5% ; WF figé 8 tranches 2018→2026 : v2 +77,6% (4/8) vs v1 +74,0% (3/8).
2. **Anatomie** : le régime bear = contexte (~0 seul) ; le moteur = la mécanique d'excursion
   (stop cappé -5%, recross rapide, ré-entrée immédiate → asymétrie -2,6%/+9,2%, payoff 3,5:1).
   La double confirmation reste l'edge le plus net (+31→+62% ET DD -45→-30 sur 2019→2026).
3. **AUCUNE amélioration trouvée** — 12 familles testées, toutes réfutées (voir ledger).
   La v2 défauts (3d/60/8, confirm 1d/200/30, 4h, stop 2,5×ATR cap 5%) est un optimum local
   sur tous les axes sondés. C'est un résultat : on sait maintenant POURQUOI elle marche.
4. **Livrables produit** : fix candleStore (3d/1w agrégés depuis le 1d, ancre 3d corrigée dans
   alignOpenTime — la grille Binance est ≡1 mod 3, PAS multiple d'epoch) + tests ; données
   réparées (fix3d.sql) ; doc HTML v2 révisée (chiffres honnêtes + section validation) ;
   docstrings v2/v3 mis à jour.
5. **Attentes réalistes** : stratégie de bear — 2024-01→2026-07 n'a donné que +4,9% (pas de bear
   soutenu) ; la tranche 2025-07→2026-07 tourne à +23,7% (14 tr). Bootstrap P(≤0)≈10% sur 65
   trades : la part de variance est réelle, dimensionner les attentes en conséquence.

## Journal

- 2026-07-02 : campagne lancée. Moteur audité (pas de lookahead). Données spot étendues à 2017-08.
- 2026-07-02 : BUG DONNÉES 3d/1w (Vision monthly) trouvé + réparé. Baselines révisées à la baisse.
- 2026-07-02 : validation complète — edge réel mais plus mince que documenté, concentré dans la
  mécanique d'excursion. Priorité amélioration = exits (trailing/ladder), pas nouveaux filtres régime.
- 2026-07-02 : exits (trail/ladder/min-hold) réfutés ; filtres d'entrée (funding/vol/ATH/âge/sessions)
  réfutés ; cooldown réfuté (le trade après perte rapporte PLUS) ; plateau re-cartographié (défauts
  confirmés) ; grain 4h validé vs 1h/2h/8h/12h. Fix produit candleStore+alignOpenTime (tests 112/112).
  Doc HTML + docstrings + mémoire mis à jour. CAMPAGNE CLOSE.
