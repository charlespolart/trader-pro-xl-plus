# leadlag1 — lead-lag BTC/gros-caps → alts au grain 1d (H5, protocole pré-enregistré)

**Ouvert le 2026-07-16, committé AVANT toute exécution.** H5 ROADMAP :
l'information s'incorpore d'abord sur l'actif liquide (BTC, gros caps), les
petits suivent avec retard. Littérature : réel à minutes-heures, fragile
après frais — le grain 1d est le SEUL testable avec les données en place
(1h univers = ~3,5 Go à télécharger, disque fragile → seulement si le 1d
montre quelque chose ; noté). Le spot→perp horaire : idem, parqué.

## Données

Panel univers spot 1d xsection1 (606 paires USDT survivorship-safe, base
5438) + BTCUSDT 1d. Machinerie VALIDÉE réutilisée : `xsection_u.py`
(load_panel, metrics, bh_flags — parité 5,6e-17, nulls éprouvés).
IS 2019-07→2024-01, OOS 2024-01→2026-07 (une passe, à la fin, seulement si
IS tient la chaîne).

## Familles (FIGÉES — 2 familles de timing, pas d'extension sans re-commit)

- **L1 « BTC mène le panier »** : signal = rendement BTC cumulé des L
  derniers jours (L ∈ {1, 3, 7}) au close t → position sur le panier EW des
  alts éligibles (≥91 j d'historique, prix fini) exécutée sur r(t+1) :
  - long-only : panier si signal > 0, flat sinon ;
  - L/S : long panier si > 0, short si < 0.
  6 cellules.
- **L2 « les gros mènent les petits »** : signal = rendement EW des 20 plus
  gros par dollar-volume 30 j (recalculés mensuellement, zéro lookahead) ;
  cible = panier EW du reste (petits). Mêmes L et modes → 6 cellules.
- 12 cellules au total, BH-FDR 10 % sur l'ensemble.

## Éval & garde-fous

- Coûts 30 bps/côté sur le notionnel tourné (un timing quotidien qui flippe
  souvent paie TRÈS cher — c'est le juge de paix attendu) ; stress ×2.
- **Null : décalage circulaire du SIGNAL par rotation du vecteur temps**
  (k ∈ [10, n−10] jours, 1000 tirages) — le signal perd son alignement, le
  panier garde son autocorrélation. (Rotation du vecteur ENTIER — leçon
  saison1 amendement 2.)
- **Placebo** : panel prix iid-shufflé par colonne (pipeline complet) →
  ~1 % de faux positifs attendus à p<0,01.
- **Contrôle positif PLANTÉ** : signal = r_panier(t+1) volé (fuite
  délibérée d'un jour) → la machinerie DOIT exploser (Sharpe >> 3,
  p=0,001) ; sinon elle ne voit rien, stop.
- Sous-métriques : turnover annualisé, coût annuel, Sharpe par année.
- Barre de survie (chaîne standard, inchangée) : 1. BH p<0,01 ;
  2. Sharpe ≥ 0,8 ET Calmar > 1 ; 3. stabilité par année (majorité
  positives, aucune ≤ −1) ; 4. coûts ×2 → Sharpe > 0,5 ; 5. OOS unique :
  même signe, ≥ 50 % du Sharpe IS.

## Journal

- 2026-07-16 : protocole écrit, committé avant exécution.
