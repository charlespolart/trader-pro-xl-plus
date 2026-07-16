# listing2 — stratégie « short-new-listings » EN CHEMIN quotidien (protocole pré-enregistré)

**Ouvert le 2026-07-16, committé AVANT toute exécution ET avant d'avoir
regardé le moindre chemin quotidien** (listing1 n'a exposé que des points à
7/30/60 j — les choix ci-dessous sont donc pré-déclarés à l'aveugle du path).

## Point d'honnêteté sur l'OOS (consigné d'avance)

L'OOS 2024-26 du SIGNAL a été dépensé par listing1 (drift −26 % connu). La
passe stratégie sur 2024-26 est donc une passe d'IMPLÉMENTATION (le chemin,
les stops, le funding path, les liquidations sont encore vierges), PAS une
re-validation du signal. La validation finale de la stratégie = bot démo en
marche avant (comme regime1). Aucune cellule ne sera « re-choisie » sur
2024-26 au-delà de la grille figée ci-dessous.

## Définition (FIGÉE)

- **Événement** : listing spot Binance (1re bougie 1d) dont le perp devient
  actif ≤ J+7 (1er jour de funding observé) ; **entrée = close du 1er jour
  de funding observé**.
- **Constructions (2, figées)** : S1 short nu 1× ; S2 short + long BTC 1:1
  (architecture C3 — capture l'excès).
- **Détention K ∈ {7, 14, 30} j** depuis l'entrée, sortie au close.
- **Stops (2 variantes figées)** : sans stop ; stop au close quotidien si
  le prix a monté de ≥ +50 % depuis l'entrée (évalué au close — pas
  d'intrabar ; le risque de mèche/liquidation intra-jour est traité par le
  stress ci-dessous, pas caché).
- **Portefeuille** : 1 unité de capital par événement, max M=10 événements
  ouverts simultanément (FIFO au-delà — figé), pnl agrégé quotidien.
- **Coûts** : 30 bps/côté + funding quotidien réel payé/reçu
  (funding_daily_all). Stress coûts ×2.
- Grille totale : 2 constructions × 3 K × 2 stops = 12 cellules, BH-FDR 10 %.

## Éval & garde-fous

- Fenêtres : 2019-02→2024-01 (mécanique, n≈65 tradables — consigné : l'ère
  pré-2024 sous-échantillonne la tradabilité) et 2024-01→2026-07 (l'ère
  tradable, passe d'implémentation) — rapportées SÉPARÉMENT.
- **Null** : même machinerie sur pseudo-événements (mêmes dates, actifs
  aléatoires vivants appariés — le null validé de listing1), 1000 tirages →
  percentile ≥ 95 du Sharpe portefeuille.
- **Placebo** : grille complète sur pseudo-événements → ~1 % à p<0,01.
- **Contrôle de cohérence** : S1 K30 sans stop doit retrouver ~le drift
  event study par événement (méd ≈ −20/−28 % selon l'ère), sinon bug.
- **Stress de chemin OBLIGATOIRE** : distribution du PIRE excursion
  intra-trade par événement (max adverse au close) ; part des événements
  dépassant +50/+100 % contre nous ; pnl si les trades > +100 % adverse
  sont comptés à −100 % (proxy liquidation 1×). Pire chemin documenté.
- Barre de survie : Sharpe portefeuille ≥ 0,8 ET Calmar > 1 (par ère),
  coûts ×2 → > 0,5, majorité d'événements gagnants, pire événement borné
  par le sizing (aucune cellule retenue si le proxy-liquidation inverse le
  verdict). Règle du trop-beau : tout résultat > event study → audit.

## Journal

- 2026-07-16 : protocole écrit et committé avant toute exécution.

## VERDICT (2026-07-16) : ✅ CANDIDAT N°2 DE LA MISSION — toute la barre pré-déclarée passe

**Placebo (pseudo-événements)** : 0/24 lignes à p<0,01 vs leur propre
null ✓. Enseignement consigné : les pseudo-shorts GAGNENT en brut (méd
+0,7…+8,8 %/trade — bêta short alts aux dates de listings + funding reçu)
→ le rendement « être short des alts à ces dates » n'est PAS l'edge ; le p
vs null apparié est le seul juge, et le réel le bat.

**Réel (207 événements, couverture prix perp 100 %)** :
- Ère mécanique 2019-24 : BH 11/12 ; 4 cellules passent Sharpe ≥ 0,8 ET
  Calmar > 1 : S2 K30 stop (1,31/2,16), S1 K30 stop (1,01/1,59),
  S2 K30 (1,05/1,11), S2 K14 stop (0,90/1,11).
- Ère tradable 2024-26 (passe d'implémentation, signal déjà connu —
  consigné au protocole) : Sharpe +2,6…+3,2 sur TOUTES les cellules,
  p=0,005 partout, win 67-76 %, méd/trade +16…+38 %.
- **Coûts ×2 + proxy-liquidation (cap −100 %, marge isolée)** : mécanique
  0,86…1,28 (> 0,5 exigé, et même > 0,8), tradable 2,58…3,19 — le cap
  AMÉLIORE vs le théorique (−190 % → −100 %) : nos chiffres sans cap
  étaient conservateurs. Pire trade borné à −100 % par construction.
- ⚠ Les CAGR de l'ère tradable (jusqu'à +582 %) sont un ARTEFACT de
  composition à 10 slots pleins (65 évts/an) — ne JAMAIS les citer ; les
  chiffres à retenir : Sharpe, méd/trade, DD.
- **Stress chemin** : max adverse au close méd +6 %, p90 +89 %, 22 % des
  événements > +50 %, **8 % > +100 % (liquidation d'un short 1× isolé)** ;
  le stop au close n'a PAS protégé d'un gap (pire −147 % avec stop) →
  implémentation : MARGE ISOLÉE par position OBLIGATOIRE (borne à −100 %),
  le stop close réduit la traîne mais ne l'élimine pas.
- Cellule la plus robuste (tous critères) : **S2 K30 stop** — short listing
  + long BTC 1:1, 30 j, stop close +50 %.

**Exécution OKX (notre infra)** : 55 % des événements 2024-26 couverts
(84/153, liste vivante) ; **délai de listing OKX vs Binance : médiane
+0,5 j, 80 % ≤ 3 j, 27 % OKX-first** (listTime API) — le drift étant
front-loaded, ~44 % des événements restent pleinement jouables sur OKX.
**NEXT (re-mesure d'exécutabilité, pré-déclarée ici avant exécution)** :
rejouer S2 K30 stop avec entrée = max(1er funding Binance, listTime OKX
+1 j) sur le sous-ensemble couvert, 2024-26 ; barre esprit regime1-étape-6 :
Sharpe ≥ 50 % de la version Binance sur la même fenêtre.

**Statut : candidat n°2 validé côté recherche** (comme regime1 : PAS
déployable sans chantier multi-symbole + bot démo + GO Mario — décision
parquée sur sa directive « démo plus tard »). Corrélation avec regime1 à
mesurer au moment du portefeuille (les deux shortent du junk — mais l'un en
manie chronique, l'autre à l'événement listing).

### Re-mesure exécutabilité OKX — RÉSULTAT (une passe) : PASSE ✓

84 événements couverts 2024-26, retard d'entrée réel médian 2 j (entrée au
close J+1 du listTime OKX, conservateur) : **Sharpe +1,70 vs +2,04 pour
l'entrée Binance sur le MÊME sous-ensemble (83 % — barre 50 % largement
passée)**, Calmar 4,30, méd/trade +23,2 %, win 67 %. Le drift est assez
profond et durable pour survivre au retard de listing OKX. En pratique :
~34 événements/an jouables sur notre infra (55 % de couverture), S2 K30
stop, marge isolée par position.
