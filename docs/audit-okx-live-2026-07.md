# Audit du code de l'ère Opus 4.8 (bb7cb43..a4d7479) — chantier restant

Checkup 2026-07-03 (3 agents + revue directe). **MISE À JOUR 2026-07-03 soir :
les P0 et P1 ci-dessous sont IMPLÉMENTÉS** (commits 1722566, d7e473f, 4ac2689 —
140 tests verts, smoke paper OK). Reste avant l'argent réel : le smoke démo sur
le VPS (§ Validation) + supprimer le bot VPS 21d1732f (er-flow-trend).

## P0 — avant l'argent réel — ✅ FAIT

1. ✅ **Stop jamais armé en live** : `OKXLiveAdapter.quoteLedger` (tranche de
   quote du bot, débitée/créditée à chaque fill, persistée, clampée sur le
   solde réel au reconcile) + `balances()` bot-scopées synchrones avec les
   fills + stratégies `find(asset === quoteAsset)`. Cache compte 20 s supprimé.
2. ✅ **Fills perdables** : (a) map avant REST ; (b) issue REST inconnue →
   sonde `getOrder`/`getAlgoOrder` par clOrdId (adopte + rejoue), sinon l'ordre
   reste suivi pour rattrapage ; (c) login WS refusé en vie → suspension des
   bots du mode (ordres conservés) + Telegram + reprise auto 5 min ; `start()`
   du stream n'aboutit qu'au login réussi ; (d) backfill spec §14 au reconcile
   (algo `effective` → actualSz/actualPx, partiels rattrapés, idempotent).

## P1 — ✅ FAIT

3. ✅ Redeploy : `stopAll` → `cancelOrders:false, runOnStopHook:false` (le stop
   résident survit) ; fenêtre onStop dans riskCheck pour le stop utilisateur
   (le « retour en BTC » s'exécute, vérifié en smoke) ; kill switch sans onStop.
4. ✅ clOrdId : composant temporel base36 du boot dans `makeClOrdId`.
5. ✅ reconcile guardé par étape (notes) ; auto-start 3×30 s + Telegram ;
   échec de start → `releaseExec` (plus d'adapter zombie).
6. ✅ `fmtSz` décimal fixe + floors (qty→lotSz, quoteQty→0,01) ;
   closePosition arrondi au stepSize.

## P2 (backend) — partiellement traité

- ✅ Canal WS `positions` retiré ; ✅ pollers de balance supprimés (obsolètes) ;
  ✅ `tradeId` OKX = id de fill + dédup (+ garde accFillSz) ; ✅ `feeAsset` =
  quote après conversion ; ✅ maker détecté via `execType`.
- Credentials figés à la création du routeur (rotation de clés = redémarrer).
- `Math.abs(fillFee)` transformerait un rebate maker en coût (sans effet tant
  qu'on n'utilise que MARKET/STOP_MARKET).
- Live spot : pas de seed de position initiale — un compte financé en BASE
  donne posQty=0 → bot inerte (documenter « financer en quote » ou seeder).
- Stop annulé À LA MAIN sur OKX pendant que le bot est down : marqué CANCELED
  au reconcile mais le bot ne ré-arme pas (bracket reste true) — interférence
  externe, hors modèle.
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

# Spec d'implémentation — ✅ EXÉCUTÉE le 2026-07-03 (archive)

Décisions de design prises avec le contexte complet, implémentées telles
quelles (écarts notables : la sonde d'issue inconnue attend 1,5 s avant
getOrder ; le rattrapage couvre AUSSI les partiels d'ordres encore ouverts ;
un tick sim synthétique remplit le rachat d'onStop en paper).

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

1. ✅ `bun run typecheck` (7/7) + `bun test` : 140 verts (113 + 27 nouveaux —
   ledger, map-avant-REST, adoption, backfill, clamp, dédup tradeId, clOrdId
   boot, fmtSz, getOrder) + baseline backtest reproduite à l'identique
   (btcvseth : BTC 2019→26 +61,9 %/57tr, full +126,2 % — l'édit stratégie est
   neutre).
2. ✅ Smoke paper local : bot eth-accumulator créé/démarré/arrêté proprement ;
   le « retour en ETH » d'onStop s'exécute désormais (FILLED, allocation
   entière convertie) au lieu d'être bloqué par le riskCheck puis avalé.
3. ⬜ RESTE — smoke démo OKX sur le VPS après déploiement : (a) SUPPRIMER
   d'abord le bot 21d1732f (er-flow-trend n'existe plus au registre), (b)
   créer un bot btc-accumulator démo, (c) vérifier que le STOP est ARMÉ après
   la première vente (symptôme historique P0-1) et que le ledger suit les
   fills dans les logs de réconciliation.
