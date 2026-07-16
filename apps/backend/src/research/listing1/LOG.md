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

## IS + OOS (2026-07-16) : 🎯 SIGNAL VALIDÉ — drift post-listing massif, stable, désormais tradable

**IS 2019-02→2024-01 (357 événements, panier de référence exigé — les
listings de début 2019 exclus, consigné)** :
- E1 excès vs panier EW : J+1→7 **−13,9/−12,4/−14,4 %** (moy/méd/trim10),
  J+1→30 **−22,0/−22,0/−22,9 %**, J+8→60 −14,4/−15,4/−16,0 % — percentile
  0,0 partout vs null apparié (actif aléatoire vivant même date, 1000×).
  Toute la distribution est décalée (moy≈méd≈trim), pas une queue.
- Placebo dates décalées (+90-400 j) : « sonne » à −2,8 %/30 j (1/3
  fenêtres) — EXPLIQUÉ et documenté : c'est la queue CHRONIQUE de l'effet
  d'âge (les jeunes listings sous-performent longtemps) ; l'effet DATÉ au
  listing est ~8× plus fort et décroît dans le temps (−2 %/j semaine 1 →
  −0,27 %/j ensuite). Le null apparié, lui, est sain (percentile 0,0).
- **Stabilité : négatif 5/5 années** (2019 −17,8 ; 2020 −23,8 ; 2021 −29,5 ;
  2022 −12,7 ; 2023 −12,2 % moy), 68-82 % d'événements négatifs par an —
  bull comme bear, PAS un artefact de régime.
- Tradabilité IS : 18 % seulement avec perp tôt (65/357) ; leur drift méd
  −24,7 % mais 58 % de négatifs seulement (queue droite de pumps — profil
  short d'événement : gains fréquents, grosses pertes rares).
- E2 délistings (documentaire, n=45) : excès 7 derniers jours cotés
  −16,1/−2,6/−9,6 % — dispersion énorme, non tradable (consigné d'avance).

**OOS 2024-01→2026-07, UNE passe (166 événements)** :
- **Drift J+1→30 : −25,4/−26,4/−27,2 %, percentile 0,0, 124/166 négatifs
  (75 %) — PLUS FORT que l'IS.** L'effet ne décay pas.
- **Tradabilité transformée : 93 % avec perp actif** (154/166 — Binance
  liste désormais les perps quasi simultanément au spot) ; drift des
  tradables −27,5/−28,7 %, 77 % négatifs ; funding payé par le short 30 j :
  méd +0,39 %, moy +3,85 %, p90 +13,3 % — petit devant le drift.
- Marge brute médiane grossière : ~27-28 pts par événement de 30 j, ~65
  événements tradables/an en 2024-26.

**LIMITES honnêtes (pour le protocole de stratégie, PAS encore résolues)** :
1. **Path risk** : l'event study est point-à-30 j — un short réel subit le
   CHEMIN (25 % de pumps, certains violents → liquidation possible avant
   que le drift paie). Le backtest de stratégie devra être en chemin
   quotidien avec sizing/stop/levier explicites.
2. Excès ≠ absolu : le short nu gagne l'absolu ; en bull alts l'excès
   surestime. Structure candidate : short listing + long panier/BTC
   (capture l'excès — même architecture que regime1 C3).
3. Entrée réelle = premier jour DISPONIBLE du perp (pas forcément J0) ;
   slippage des perps neufs (spreads larges premiers jours) à provisionner.
4. n OOS tradable = 154 sur 2,5 ans — solide pour un event study,
   à confirmer en démo avant tout réel (règle Phase 0 inchangée).

**PROCHAINE ÉTAPE (nouveau protocole AVANT tout backtest de stratégie)** :
« short-new-listings » en chemin quotidien — entrée au 1er jour perp
disponible, détention K∈{7,14,30} j FIGÉS, variantes {short nu, short +
long panier} FIGÉES, sizing par événement, stop/pas-de-stop pré-déclaré,
coûts perp + funding réels, IS/OOS mêmes fenêtres, chaîne de survie
standard. À committer avant exécution.
