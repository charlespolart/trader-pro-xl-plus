# listing1 — événementiel listings/délistings Binance (H9, protocole pré-enregistré)

**Ouvert le 2026-07-16, committé AVANT toute exécution.** H9 ROADMAP : flux
d'offre/demande datés et publics. Ici : le LISTING spot Binance d'une paire
USDT (date = première bougie 1d Vision, fiable — archive complète) et le
DÉLISTING (dernière bougie ; l'annonce précède l'arrêt de ~7 j).

## Données

603 paires USDT spot 1d (base 5438, survivorship-safe). Listings = paires
dont la première bougie est POSTÉRIEURE au 2019-02-01 (marge : les paires
présentes dès 2019-01 sont des pré-existantes, pas des événements).
n attendu ≈ 400+. IS événementiel 2019-02→2024-01 ; OOS 2024-01→2026-07
(une passe, seulement si l'IS montre un signal robuste).

## Mesures (event study en EXCÈS vs marché — jamais un backtest)

- **E1 drift post-listing** : rendement log en excès du panier EW des alts
  vivants (≥91 j) sur les fenêtres [J+1→J+7], [J+1→J+30], [J+8→J+60] où
  J0 = premier jour coté (position prise au close J0 — implémentable).
  Thèse littérature : pump initial puis drift NÉGATIF chronique.
- **E2 fenêtre pré-délisting (DOCUMENTAIRE, non tradable — consigné
  d'avance : borrow impossible, perp souvent retiré avant)** : excès sur
  [fin−7 → fin] (approximation de la fenêtre post-annonce Binance).
  Informe le risque de la jambe short regime1 (perps moribonds).

## Éval & garde-fous

- Excès vs panier EW contemporain (retire le facteur marché du même jour).
- **Stats robustes OBLIGATOIRES** : moyenne ET médiane ET trim10 — les
  microcaps fraîchement listées ont des queues énormes (leçon trop-beau).
- **Null timing-aveugle apparié** : mêmes fenêtres calendaires appliquées à
  des actifs aléatoires VIVANTS à la même date (1000 rééchantillonnages de
  même n) → percentile de la stat réelle ; barre maison ≥ 95.
- **Placebo** : mêmes pipelines avec dates d'événements décalées
  aléatoirement (±90-400 j) sur les mêmes actifs → ~5 % attendus au-dessus
  du percentile 95.
- Exploitabilité jugée SÉPARÉMENT si signal : côté short → part des
  listings ayant un perp dans les 30 j (funding cnt) + coûts ; côté long →
  coûts standard. Un signal réel non tradable = verdict « info, pas de
  strat » (utile : règle d'hygiène pour les stratégies futures).

## Journal

- 2026-07-16 : protocole écrit, committé avant exécution.
