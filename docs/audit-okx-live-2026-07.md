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

---

# Spec d'implémentation (préparée à chaud en fin de session d'audit)

Décisions de design prises avec le contexte complet — la session d'exécution
peut les suivre directement. Ordre = ordre d'implémentation recommandé.

## 1. P0-1 — balances bot-locales dans l'adapter (le fix du stop jamais armé)

**Design : l'adapter dérive les balances de SON état, comme SimExchange** (c'est
la parité backtest/live, pas un cache de compte).
- Ajouter `quoteLedger` à OKXLiveAdapter : initialisé à `allocation` au premier
  start (persisté dans snapshot()/restore() comme posQty), débité à chaque fill
  BUY (coût + fee en quote), crédité à chaque fill SELL (produit − fee).
- `balances()` retourne exactement 2 lignes bot-scopées :
  `[{asset: baseAsset, free: posQty}, {asset: quoteAsset, free: quoteLedger}]`
  → synchrone avec les fills (le onFill de la stratégie voit l'USDC de la vente
  immédiatement), borné par l'allocation (plus de dépense du compte entier),
  plus de dépendance au poller 20 s (le garder pour la page Account seulement).
- Dérive long-terme : au reconcile, clamp `quoteLedger = min(ledger, free réel
  du compte)` avec note de log si écart > 1 %.
- Durcissement stratégies (btc-accumulator + eth-accumulator) : remplacer les
  3 `find(b => b.asset !== baseAsset)` par `find(b => b.asset === symbolInfo.quoteAsset)`.
- Tests : séquence sell→fill→onFill-voit-le-quote ; buy partiel ; restore.

## 2. P0-2 — fills fiables (4 sous-chantiers, dans cet ordre)

a. **Map avant REST** (okxLiveAdapter.submit) : insérer l'Order (status NEW)
   AVANT `placeOrder` ; sur rejet REST → status REJECTED + retirer ; un push WS
   arrivé entre les deux trouve l'ordre (les fills sont idempotents par tradeId
   — voir P2 tradeId, à faire en même temps).
b. **Issue REST inconnue** : implémenter `OkxAccount.getOrder(instId, {clOrdId})`
   (GET /api/v5/trade/order) ; sur timeout du place → getOrder avant de déclarer
   l'échec (adopter si trouvé).
c. **Backfill au redémarrage** (le stub spec §14) : dans reconcile(), pour chaque
   RestingOrderRef absent des pending → getOrder par clOrdId → si executedQty
   final > executedQty connu, émettre la différence en fill synthétique (prix =
   avgPx). Couvre le « stop déclenché pendant le down → double rachat ».
d. **Mort du login WS = incident** : le onError de OkxPrivateStream porte déjà
   le cas login-failed → botManager doit alors (1) suspendre les bots live du
   compte (stop keepDesired SANS annuler les ordres), (2) alerte Telegram,
   (3) retry du stream avec backoff long (5 min). Ne PAS trader en aveugle.

## 3. P1 dans l'ordre

- **Shutdown (P1-4)** : `stopAll(keepDesired)` → `stop({cancelOrders: false,
  runOnStopHook: false})`. Le stop résident survit au redeploy (reconcile le
  ré-adopte déjà). Pour un stop UTILISATEUR : bypasser riskCheck pour les ordres
  émis pendant status='stopping' (flag runner), sinon le « retour en BTC » de
  onStop reste mort. Logger au lieu d'avaler dans runtime.stop().catch.
- **clOrdId (P1-8)** : dans restore(), `seq = max(seq restauré, floor(Date.now()/1000) % 36^4)`
  n'est PAS monotone — préférer : composant temporel dans l'id →
  `makeClOrdId(prefix, seq, bootMs)` = prefix + base36(bootMs) + base36(seq),
  vérifier ≤ 32 alnum (11 + 9 + ~3 = OK). Adapter le test okxOrders.
- **reconcile non protégé (P1-10)** : try/catch par appel REST dans reconcile
  (notes d'erreur, jamais throw) ; auto-start de init() avec 3 retries backoff
  30 s ; dans le catch de manager.start() → router.releaseAdapter (zombie fix).
- **sz non arrondi (P1-12)** : dans orders.sizeFor : qty → floorToStep(qty, lotSz
  base pour spot / contrats pour swap déjà géré) + formatage décimal fixe
  (jamais d'exponentielle : helper fmtSz(x, decimals du lotSz)) ; quoteQty →
  floorToStep(x, 0.01). closePosition (botManager) → passer par roundQty avant.

## 4. P2 à faire en même temps si peu coûteux

- tradeId OKX dans OkxOrderEvent + id de fill = tradeId (dédup sûre) — requis
  par 2a de toute façon.
- feeAsset = quoteAsset après conversion dans emitFill.
- Supprimer la souscription WS `positions` (ou la router vers un check de désync).
- Arrêter les pollers de balance quand plus aucun bot ne les utilise.

## 5. Validation de la session d'exécution

1. `bun run typecheck` + `bun test` (113 verts aujourd'hui) + nouveaux tests
   (ledger, getOrder-adoption, clOrdId, fmtSz).
2. Smoke paper local : bot eth-accumulator paper (spot marche en local via
   mirror), vérifier logs de fills + stop posé après une vente simulée.
3. Smoke démo OKX sur le VPS (le bot 21d1732f du handoff précédent) : vérifier
   que le stop est ARMÉ après la première vente (c'était le symptôme P0-1).
