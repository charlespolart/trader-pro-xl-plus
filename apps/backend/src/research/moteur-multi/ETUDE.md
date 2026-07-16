# ÉTUDE — exécuteur MULTI-SYMBOLE pour les candidats regime1 & listing2

**2026-07-17. Étude d'architecture UNIQUEMENT (Phase 0 : zéro code live,
zéro modification du runtime déployé). Objectif : quand Mario donnera le GO
démo, savoir exactement quoi construire, en combien de temps, avec quels
risques.**

## 1. Le constat d'architecture (cartographie vérifiée)

Toute la plateforme repose sur l'invariant **1 bot = 1 StrategyRuntime =
1 ExecutionAdapter = 1 symbole = 1 position** (`ExecutionAdapter.symbol`
readonly, `bots.symbol` unique en base, `ctx.position/order/equity`
scalaires). MAIS trois briques sont DÉJÀ prêtes pour le portefeuille :

- **Données multi-symboles** : les FeedSpec acceptent un `symbol` par feed
  (eth-accumulator lit déjà BTCUSDT en prod) ; `LiveFeeds` mutualise un
  socket Binance ref-compté (40-80 streams = confortable) ; le vrai goulot
  d'amorçage est le backfill REST (rate-limité par poids), pas le WS.
- **Exécution OKX SWAP complète** : ordres market/limit/trigger avec
  dimensionnement en contrats (`okx/orders.ts` sizeFor), positions/levier/
  fees (`okx/account.ts`), socket privé DÉJÀ multi-instrument
  (`instType:'ANY'`) routé par préfixe de clOrdId (`OkxUserStreamRouter`).
  Réserves : `tdMode` câblé en `isolated` seulement (suffisant, voir §3) ;
  funding non attribué par bot (à câbler, voir §5) ; AUCUNE stratégie
  futures n'a jamais tourné en live (plomberie éprouvée en paper/backtest
  seulement).
- **Scheduler** : le pattern « tâche périodique + cadence par bot » existe
  (`RefitService`, setInterval horaire + everyDays), et les gardes
  post-incident 2026-07-14 (pré-trade sur soldes réels, dérive bloquante,
  kill switch, Telegram par transaction) sont mûres et testées.

## 2. La décision structurante : un PortfolioRunner SÉPARÉ, pas une généralisation

Deux voies possibles :
- (A) **Généraliser** defineStrategy/StrategyRuntime/SimExchange au
  multi-instrument — chantier lourd (contrat, moteur backtest, UI), qui
  TOUCHE le chemin critique des 3 bots live. Risque de régression réel,
  bénéfice différé.
- (B) **PortfolioRunner dédié** : un second type d'exécuteur, à côté du
  BotRunner, spécialisé « stratégies de portefeuille au grain quotidien,
  ordres market ». Les deux candidats sont EXACTEMENT ça : regime1
  rebalance tous les 7 jours à la clôture ; listing2 entre/sort au close
  quotidien. Ni intrabar, ni stops temps réel, ni WS obligatoire.

**Recommandation : (B), sans hésitation.** Zéro risque pour les bots live
(aucun fichier partagé modifié hors ajouts), périmètre 5× plus petit,
et le grain quotidien élimine 80 % de la complexité du BotRunner
(pas de dispatch WS, pas d'intrabar, pas de reprise de stream).
La généralisation (A) restera possible plus tard si un candidat intraday
multi-symbole émergeait un jour.

## 3. Architecture du PortfolioRunner (composants)

1. **`PortfolioAdapter` (nouveau)** — multi-instId sur le compte OKX :
   - état = `Map<instId, Position>` réconciliée contre
     `account.allPositions('SWAP')` (la vérité exchange, comme aujourd'hui) ;
   - ordres market par instId (la couche `okx/orders.ts` sert telle
     quelle) ; **tdMode ISOLATED par position** — déjà câblé, et c'est un
     CHOIX de design, pas un pis-aller : pour listing2 la marge isolée est
     OBLIGATOIRE (borne la perte d'un pump à −100 % du slot, cf. LOG) ; pour
     regime1 elle borne chaque jambe et rend les gardes triviales. Le cross
     n'apporterait que de l'efficience de marge — inutile aux tailles démo.
   - pré-trade par ordre : positions + soldes réels relus avant chaque
     batch (portage direct de `preTradeGate`).
2. **Scheduler quotidien (pattern RefitService)** — tick à 00:10 UTC :
   ingestion funding Binance J-1 (fundingStore existant) + closes 1d
   (candleStore) → calcul des CIBLES (porte/éligibilité/quintile regime1 ;
   détection listing + gestion des slots listing2 — définitions FIGÉES,
   portage 1:1 des scripts de recherche) → diff cibles vs positions
   réelles → batch d'ordres market (rate limit OKX : 60 ordres/2 s, un
   rebal de ~35 noms passe en un tick).
3. **Persistance** : réutiliser `bots` (symbol='PORTFOLIO', un bot
   conteneur par stratégie), `bot_state.state` porte l'état par instId ;
   `orders/fills/trades` acceptent déjà un symbol par ligne. Pas de
   migration de schéma nécessaire (une vue UI dédiée plus tard).
4. **Gardes portées** (invariants de l'incident 2026-07-14 préservés) :
   attribution des fills par clOrdId préfixé (routeur existant),
   réconciliation au boot ET à chaque tick (le tick quotidien EST une
   réconciliation naturelle), dérive → gel + Telegram, kill switch global
   réutilisé, plafond d'exposition portefeuille (Σ|notional| ≤ X).
5. **Funding par position (nouveau, indispensable en perps)** : ingestion
   des bills OKX (`/account/bills`, type funding) attribuée par instId —
   en portefeuille de perps, le funding EST une part du P&L (regime1 le
   REÇOIT sur les shorts). Sans ça, l'équité dérive silencieusement.
6. **Mode PAPER du runner** : au grain close-quotidien, un paper trivial
   suffit (fill au close ± slippage paramétré, funding réel ingéré) — pas
   besoin de SimExchange. La **validation de parité** se fait contre les
   scripts python de recherche : même journée, mêmes cibles, mêmes poids
   (barre : cibles identiques à 100 %, pnl quotidien à ±tolérance de
   slippage) pendant ≥ 2 semaines avant tout ordre démo réel.

## 4. Chiffrage honnête (dev focalisé, hors imprévus)

| Lot | Contenu | Estimation |
|---|---|---|
| L1 PortfolioAdapter | multi-instId, isolated, market, pré-trade, reconcile | 3-5 j |
| L2 Scheduler + données | tick quotidien, funding+closes, pipeline cibles | 2-3 j |
| L3 Portage regime1 TS | porte/éligibilité/quintile/K7 (définitions figées) | 2-3 j |
| L4 Portage listing2 TS | détection listing, slots, stop-close, K30 | 1-2 j |
| L5 Funding bills OKX | ingestion + attribution par instId | 1-2 j |
| L6 Gardes + Telegram | portage des invariants incident + notifications | 2-3 j |
| L7 Paper + parité python | 2 semaines de marche à blanc comparée | 3-4 j de dev + 2 sem. calendaire |
| L8 UI lecture seule | positions/pnl du portefeuille (optionnel phase 1) | 1-2 j |

**Total : ~15-24 jours de dev** pour les DEUX candidats (ils partagent
L1/L2/L5/L6/L7 ≈ 70 % de l'effort). Le premier candidat en paper ≈ 2
semaines de dev + 2 semaines de marche à blanc.

## 5. Risques identifiés (et parades)

1. **Funding non attribué** (note existante dans okxLiveAdapter) → L5
   obligatoire, pas optionnel.
2. **Tailles de contrat du junk OKX** (ctVal hétérogènes, minSz) →
   `sizeFor` existe ; REJETER les cibles < minNotional (poids re-normalisé,
   compté — même convention que la recherche).
3. **Slippage des perps fins** : ordres market au close sur ~35 noms —
   provision 30 bps déjà dans les backtests ; mesurer en démo (écart
   fill vs close de référence, alerte si > 2× la provision).
4. **Sous-compte OKX DÉDIÉ fortement recommandé** : blast radius borné,
   gardes de dérive triviales (tout le compte = le portefeuille), pas de
   collision avec les 3 bots spot existants.
5. **Jamais de futures en live jusqu'ici** : la démo commence en PAPER,
   puis tailles minimales (~30 USDT/jambe) sur le sous-compte avant la
   sleeve cible — même escalade que le smoke de juillet.
6. **Données Binance géo-bloquées côté REST fapi** : le funding vient de
   fundingStore (Vision/REST fallback validé) ; le tick quotidien tolère
   J-1 (le backtest utilise le funding de la veille — parité exacte).

## 6. Plan d'exécution proposé (au GO démo)

Phase A (semaines 1-2) : L1+L2+L3+L5 → regime1 en PAPER sur sous-compte.
Phase B (semaine 3) : L4+L6 → listing2 en paper, gardes complètes.
Phase C (2 semaines calendaires) : marche à blanc, parité python
quotidienne, revue des écarts avec Mario → GO tailles minimales réelles.

**Rien de tout ceci n'est commencé : ce document est le livrable de
l'étude. Le GO démo de Mario déclenche la Phase A.**
