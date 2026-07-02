# Audit du code de l'ère Opus 4.8 (bb7cb43..a4d7479) — chantier restant

Checkup 2026-07-03 (3 agents + revue directe). Les correctifs chirurgicaux sont
commités ; CE DOCUMENT liste ce qui reste à faire, par priorité. **Les P0 sont
un prérequis avant de passer du démo au réel.** Cause structurelle commune :
l'état spot d'un bot n'est reconstruit QUE par le flux WS privé, sans source
REST de rattrapage.

## P0 — avant l'argent réel

1. **Le stop de protection n'est quasi jamais armé en live** (strategies +
   botManager) : `onFill` lit `ctx.balances` = cache pollé 20 s → l'USDC de la
   vente n'y est pas encore → `usdt=0`, stop sauté, `bracket=true` posé quand
   même. Aggravants : `find(asset !== base)` prend le premier asset non-BTC du
   compte (pas `quoteAsset`), et le montant = solde du COMPTE entier (pas la
   tranche du bot). Fix : balances dérivées de l'état du bot exposées au
   runtime (comme SimExchange), ou refresh du cache à chaque fill ; filtrer
   par quoteAsset ; borner par allocation.
2. **Fills perdables sans rattrapage** (okxLiveAdapter/privateWs) :
   (a) l'ordre n'entre dans la map qu'APRÈS l'ack REST → un push WS `filled`
   plus rapide est jeté ; (b) réponse REST perdue → ordre orphelin + bot error ;
   (c) échec de login WS (rotation clés, IP, horloge) → stream stoppé
   définitivement, bots continuent en aveugle sans alerte ; (d) rattrapage spot
   au redémarrage = stub (spec §14) → un stop exécuté pendant le down = double
   rachat. Fix : map avant REST ; backfill `/api/v5/trade/fills` (ou getOrder
   par clOrdId) au reconnect/boot ; mort du login → pause bots + Telegram.

## P1

3. **Redeploy** : `stopAll` annule le stop résident (cancelOrders=true) et le
   rachat d'`onStop` est bloqué par riskCheck (status='stopping') puis avalé —
   sur shutdown keepDesired : ne pas annuler les ordres, ne pas appeler onStop.
4. **clOrdId réutilisable après crash** (seq snapshoté 15 s) → rejet 51016 ou
   écrasement d'un ancien ordre en DB. Fix : composant temporel dans le seq.
5. **reconcile() non protégé** : un 5xx OKX au boot → auto-resume échoue en
   silence (+ adapter zombie enregistré sur le routeur). Fix : guards +
   retry/backoff + release dans le catch.
6. **closePosition/quoteQty non arrondis** (`sz` rejeté par lotSz, notation
   exponentielle) → la fermeture d'urgence peut échouer en silence. Fix :
   floor lotSz/0,01 + format décimal fixe dans sizeFor.

## P2 (backend)

- Canal WS `positions` souscrit mais jeté par le routeur (le supprimer ou s'en
  servir pour détecter les désyncs futures).
- Pollers de balance jamais arrêtés par bot + credentials figés à la création.
- Id de fill `${clOrdId}-${time}-${qty}` : capturer `tradeId` OKX (dédup sûre).
- `fill.feeAsset` garde la devise d'origine après conversion en quote.
- `Math.abs(fillFee)` transformerait un rebate maker en coût (sans effet tant
  qu'on n'utilise que MARKET/STOP_MARKET).
- Live spot : pas de seed de position initiale — un compte financé en BASE
  donne posQty=0 → bot inerte (documenter « financer en quote » ou seeder).
- EEA : stop `triggerPxType:last` sur la paire USDC vs signal Binance USDT —
  un depeg USDC déclencherait le rachat au pire prix (risque assumé, à savoir).

## P2 (web)

- PaperFeesCard/RiskCard : pattern « état init depuis props async » corrigé par
  gating ; généraliser si d'autres cartes apparaissent.
- dialog.tsx : deux dialogs concurrents → la 1ʳᵉ promesse ne se règle jamais
  (fail-safe, mais à filer).
- Backtests.tsx : frais initialisés spot même si la stratégie résout futures.
- TradingChart : séries d'indicateurs recréées à chaque tick de replay (perf) ;
  zones/markers antérieurs à la fenêtre snapés sur la 1ʳᵉ bougie (latent).

## Infra (recommandations restantes)

- Copie HORS-VPS des backups hebdo (destination à choisir).
- Host key SSH épinglée (secret) au lieu de ssh-keyscan TOFU.
- deploy-web : rsync --delete → dossier temporaire + bascule atomique.
- Session : HKDF pour la clé (≠ MASTER_KEY brut), timingSafeEqual, rate-limit.
- env_file : ne passer au conteneur que les variables nécessaires.
