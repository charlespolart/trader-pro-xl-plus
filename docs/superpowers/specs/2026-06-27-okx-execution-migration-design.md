# Migration de l'exécution Binance → OKX

**Date :** 2026-06-27
**Statut :** design validé, prêt pour le plan d'implémentation

## 1. Contexte & objectif

On ne peut plus trader sur Binance (régulation). On bascule **l'exécution** (compte,
ordres, fills, levier/marge) sur **OKX**. En revanche, **les données de marché restent
Binance** : l'archive publique `data.binance.vision` et les flux WS publics ne demandent
ni compte ni clé API — la régulation ne bloque que l'API de trading authentifiée, pas les
données publiques.

### Principe directeur : deux plans indépendants

| Plan | Venue | Pourquoi |
|---|---|---|
| **Données** (backtest + feeds live) | **Binance** (conservé) | Plus profond (1m depuis 2017), gratuit, et **seul à fournir le taker-flow dans la bougie** (`takerBuyBase/Quote`) dont dépend la recherche flow validée (`er-flow-trend`). Cohérence parfaite backtest ↔ live. |
| **Exécution** (compte, ordres, fills) | **OKX** (nouveau) | Contrainte réglementaire. |

Conséquence : le bot **décide** à partir des données Binance et **exécute** sur OKX. On
ne fait pas d'arbitrage et on n'opère pas sur des timeframes courts → l'écart de prix
inter-venues (basis) est négligeable pour les décisions. Le **prix d'entrée réel et le PnL**
sont en revanche lus depuis les **fills OKX** (vérité-terrain d'exécution).

### Non-objectifs (out of scope)

- Aucun sélecteur multi-exchange dans l'UI (OKX est la seule venue d'exécution).
  On extrait néanmoins une interface `ExchangeExecution` pour laisser le joint propre.
- Pas de re-téléchargement des données depuis OKX, pas de suppression des données Binance.
- Pas d'intégration de l'archive bulk OKX, ni de Tardis.dev (option future si recherche
  order-book/tick OKX un jour).
- Pas de mode hedge (long/short séparés) : on reste en **net / one-way**, comme le code actuel.

## 2. Ce qui change vs ce qui reste

### Conservé tel quel (plan données — aucune modification)
- `packages/data/src/store/vision.ts` + archive Binance Vision.
- `packages/data/src/binance/market.ts` (klines, aggTrades, funding, exchangeInfo REST).
- `packages/data/src/binance/ws.ts` → `BinanceMarketWs` (flux marché live).
- `packages/data/src/binance/rest.ts` → **partie publique** (`public()`), failover 451 vers
  `data-api.binance.vision`, sync horloge.
- `packages/data/src/binance/endpoints.ts` → URLs market-data.
- Stores `candleStore` / `aggTradeStore` / `fundingStore`, schéma `candles`
  (`takerBuyBase` reste rempli depuis Binance), `funding_rates`, `aggtrade_files`.
- `apps/backend/src/services/liveFeeds.ts` (alimente le bot en live) → reste Binance.
- Indicateur `packages/core/src/indicators/flow.ts` (lit `takerBuyBase`).
- Tout le backtester (`SimExchange`) — exchange-agnostique.

### Remplacé par OKX (plan exécution)
- `packages/data/src/binance/account.ts` → `packages/data/src/okx/account.ts`.
- `BinanceUserStream` (listenKey/user-data) → `packages/data/src/okx/privateWs.ts`.
- `apps/backend/src/services/liveAdapter.ts` → `OKXLiveAdapter` + `OKXUserStreamRouter`.
- `apps/backend/src/services/credentials.ts` → ajoute `passphrase`.
- `packages/shared/src/fees.ts` → barème OKX, suppression de `bnbDiscount`.
- Wiring dans `apps/backend/src/services/botManager.ts` (levier/marge/instId OKX).
- UI `apps/web/src/pages/Settings.tsx` (champ passphrase, toggle démo, affichage frais OKX).

### Supprimé
- La **partie signée** de `BinanceRest` (`signed()`, `keyed()`, syncTime au service du
  trading) **si** elle n'est plus utilisée par le market-data (à vérifier : le market-data
  public n'utilise que `public()`). On conserve `BinanceRest` pour le public, on retire le
  signing Binance si plus aucun appelant.
- `BinanceCredentials` (type), `BinanceAccount`, `BinanceUserStream`.

## 3. L'abstraction `ExchangeExecution`

L'interface `ExecutionAdapter` (`packages/core/src/strategy/types.ts`) **ne change pas** :
elle est déjà l'abstraction que voient la stratégie et le backtester. On ajoute en dessous
une interface **bas-niveau** côté `@tpx/data`, implémentée par OKX, qui isole les détails
venue :

```ts
// packages/data/src/exchange/types.ts (nouveau)
export interface ExchangeAccountClient {
  balances(market: MarketType): Promise<Balance[]>
  positions(instId: string): Promise<ExchangePosition[]>          // futures
  tradeFee(instType: OkxInstType, instId: string): Promise<{ maker: number; taker: number; level: string } | null>
  setLeverage(instId: string, leverage: number, mgnMode: 'isolated' | 'cross'): Promise<void>
  placeOrder(req: ExchangePlaceOrder): Promise<ExchangeOrderAck>
  placeAlgoOrder(req: ExchangePlaceAlgoOrder): Promise<ExchangeOrderAck> // stops / TP
  cancelOrder(instId: string, ids: { clOrdId?: string; ordId?: string }): Promise<void>
  cancelAlgoOrder(instId: string, ids: { algoClOrdId?: string; algoId?: string }): Promise<void>
  openOrders(instId: string): Promise<ExchangeOrderRaw[]>
  openAlgoOrders(instId: string): Promise<ExchangeOrderRaw[]>
  instrument(instId: string): Promise<ExchangeInstrument>         // tickSz/lotSz/minSz/ctVal…
}

export interface ExchangePrivateStream {
  start(): Promise<void>
  stop(): void
  /** un seul flux par compte (compte unifié OKX), routage par préfixe de clOrdId */
  onEvent(cb: (ev: OkxPrivateEvent) => void): void
}
```

Le backend (`OKXLiveAdapter`) implémente `ExecutionAdapter` en s'appuyant sur
`ExchangeAccountClient` + `ExchangePrivateStream`. Une 3ᵉ venue future n'aurait qu'à
fournir ces deux interfaces.

## 4. Client REST OKX (`packages/data/src/okx/rest.ts`)

### Base & environnement
- Base prod : `https://www.okx.com`. (Régions : `us.okx.com`, `eea.okx.com` — paramétrable,
  défaut `www`.)
- **Démo (= ancien `testnet`)** : même base + header `x-simulated-trading: 1` + **clés API
  démo distinctes**. Le flag `testnet` du bot devient « compte démo OKX ».

### Authentification (signée)
4 headers sur chaque requête privée :
- `OK-ACCESS-KEY` : apiKey
- `OK-ACCESS-SIGN` : `base64( HMAC_SHA256( secret, prehash ) )`
- `OK-ACCESS-TIMESTAMP` : horodatage **ISO-8601 ms UTC** (ex. `2026-06-27T09:08:57.715Z`),
  **pas** un epoch ms — rejet si décalage > 30 s.
- `OK-ACCESS-PASSPHRASE` : passphrase de la clé.
- `Content-Type: application/json` sur POST.

`prehash = timestamp + method + requestPath + body`
- GET : `requestPath` inclut la query string ; `body` = `''`.
- POST : `body` = la chaîne JSON exacte envoyée.

### Réponses & erreurs
- Enveloppe OKX : `{ code: "0", msg: "", data: [...] }`. `code !== "0"` → erreur
  (`OkxApiError(code, msg, httpStatus)`). Erreurs aussi possibles au niveau `data[i].sCode`
  pour les ordres (succès HTTP mais ordre rejeté).
- Rate limit par endpoint (fenêtres 2 s) ; backoff sur `50011`/HTTP 429.

## 5. Symboles, instruments & contrats

### Mapping symbole interne ↔ instId OKX
Le bot raisonne en symbole **Binance** (`BTCUSDT`) côté données. À l'exécution, on mappe :
- spot : `BTCUSDT` → `BTC-USDT`
- futures (perp USDT-margé) : `BTCUSDT` → `BTC-USDT-SWAP`

Implémentation : dériver base/quote depuis `SymbolInfo` (déjà connu) et composer l'instId.
**Garde-fou au démarrage du bot** : appeler `/api/v5/public/instruments` pour vérifier que
l'instId existe ; sinon refuser de démarrer avec un message clair (symbole non listé OKX).

### Métadonnées d'instrument (`/api/v5/public/instruments`)
Champs utilisés : `tickSz` (pas de prix), `lotSz` (pas de taille), `minSz` (taille min),
et pour SWAP `ctVal` / `ctValCcy` / `ctMult` / `lever` (levier max).

**Source de vérité pour l'arrondi des ordres = OKX** (pas l'`exchangeInfo` Binance). Le
prix/qty calculés par la stratégie (sur données Binance) sont arrondis aux règles OKX
avant envoi.

### Sizing des contrats (perp)
OKX exprime `sz` en **nombre de contrats**, pas en coins. Conversion :
```
contracts = floorToStep( baseQty / ctVal , lotSz )   // ctVal = taille d'un contrat en base
baseQty  ≈ contracts * ctVal
```
Le PnL et les quantités affichées restent en base/quote internes ; la conversion
contrats↔base est **confinée au client OKX**. `SymbolInfo` gagne un champ optionnel
`contractSize?: number` (= `ctVal`) pour le futures OKX ; vaut `undefined`/`1` en spot.

## 6. Mapping des types d'ordres (TPX → OKX)

| TPX `OrderType` | OKX | Endpoint |
|---|---|---|
| `MARKET` | `ordType: market` | `/api/v5/trade/order` |
| `LIMIT` | `ordType: limit` | `/api/v5/trade/order` |
| `LIMIT_MAKER` | `ordType: post_only` | `/api/v5/trade/order` |
| `STOP_MARKET` | algo `ordType: trigger`, `orderPx: -1` (market) | `/api/v5/trade/order-algo` |
| `STOP_LIMIT` | algo `ordType: trigger`, `orderPx: <px>` | `/api/v5/trade/order-algo` |
| `TAKE_PROFIT_MARKET` | algo `trigger` (TP) | `/api/v5/trade/order-algo` |
| `TAKE_PROFIT_LIMIT` | algo `trigger` (TP) | `/api/v5/trade/order-algo` |

Différence structurante vs Binance : **les stops/TP sont des "algo orders"** sur un endpoint
séparé, avec leurs propres IDs (`algoId`/`algoClOrdId`) et un **canal WS privé séparé**
(`orders-algo`). L'adapter gère donc deux familles d'ordres et **deux souscriptions WS**
(`orders` + `orders-algo`). Le statut `TRIGGER_PENDING` correspond à un algo `live` non
déclenché.

### Paramètres communs à tout ordre
- `instId`, `side` (`buy`/`sell`), `clOrdId` (voir §7), `tag` optionnel.
- `tdMode` : `cash` (spot) | `isolated` (perp, défaut) | `cross`.
- `posSide` : `net` (mode one-way). On ne fournit pas long/short séparés.
- `reduceOnly: true` pour les sorties futures.
- **Spot market sizé en quote** (équiv. `quoteOrderQty`) : `ordType: market` + `sz: <quote>`
  + `tgtCcy: quote_ccy`. Spot market sizé en base : `tgtCcy: base_ccy`.

## 7. Identifiant client (`clOrdId`) — attribution des fills

Le routage des événements vers le bon bot se fait par **préfixe de `clOrdId`** (comme
aujourd'hui avec Binance). **Contrainte OKX : `clOrdId` alphanumérique uniquement, 1–32
caractères — pas d'underscore.**

→ Nouveau schéma (remplace `tpx_<botid10>_<base36ts><seq>`) :
```
clOrdId = `tpx${botId.replace(/[^a-z0-9]/gi,'').slice(0,8)}${base36(seq)}`
// ex: tpx7f3a9c21k   (≤ 32, alphanumérique)
prefix  = `tpx${botId8}`   // sert au routage
```
Le routeur retrouve l'adapter par `clOrdId.startsWith(prefix)`. Idem pour `algoClOrdId`.

## 8. WS privé OKX (`packages/data/src/okx/privateWs.ts`)

- URL : `wss://ws.okx.com:8443/ws/v5/private` (démo : `wss://wspap.okx.com:8443/ws/v5/private`
  + `x-simulated-trading`). **Un seul flux par compte** (compte unifié → spot + swap
  ensemble), au lieu d'un flux par marché côté Binance.
- **Login** : frame `{op:'login', args:[{apiKey, passphrase, timestamp, sign}]}` où
  `sign = base64(HMAC_SHA256(secret, timestamp+'GET'+'/users/self/verify'))`,
  `timestamp` en **secondes** (epoch) pour le login WS (spécificité OKX).
- Souscriptions après login : `orders` (+ `orders-algo`), et `positions` (pour la
  réconciliation). Channel args par `instType` (`SPOT`, `SWAP`) ou `ANY`.
- Ping/pong : envoyer `'ping'` toutes ~25 s, reconnect + ré-login + ré-souscription sur
  coupure.

### Routage (`OKXUserStreamRouter`)
Un routeur unique par compte (≠ par marché). Sur chaque event `orders`/`orders-algo`, lire
`clOrdId`/`algoClOrdId`, trouver l'adapter par préfixe, déléguer. Remplace
`UserStreamRouter` (qui était par `(market, testnet)`).

## 9. `OKXLiveAdapter` (implémente `ExecutionAdapter`)

Reprend la structure de `BinanceLiveAdapter` (le bot possède une **tranche virtuelle** du
compte : position/PnL/frais suivis depuis le flux privé, attribués par préfixe de clOrdId ;
OCO émulé). Adaptations :

- `submit(req)` : construit l'ordre OKX (regular vs algo selon `isTriggerOrder`), convertit
  qty→contrats (perp), arrondit aux règles OKX, pose `tdMode`/`posSide`/`reduceOnly`.
- Suivi des fills : OKX pousse les remplissages via le canal `orders` avec
  `fillPx`, `fillSz` (en contrats → reconvertir en base), `fee` (signé : **négatif = frais
  prélevés**, positif = rebate ; convention inverse de Binance), `feeCcy`, `state`
  (`live`/`partially_filled`/`filled`/`canceled`), `tradeId`. PnL réalisé : `pnl` sur les
  fills réducteurs (perp).
- `mapStatus` OKX : `live`→`NEW`/`TRIGGER_PENDING`, `partially_filled`→`PARTIALLY_FILLED`,
  `filled`→`FILLED`, `canceled`→`CANCELED`, `mmp_canceled`→`CANCELED`.
- `feeToQuote` : plus de cas `BNB`. Frais en `feeCcy` (souvent quote, ou base sur spot
  buy) → normaliser en quote. Le signe négatif OKX est absorbé (on stocke un coût positif).
- `reconcile()` : futures = `positions` OKX (en contrats → base) fait foi ; spot = même
  logique qu'aujourd'hui (régler les ordres au repos via `getOrder` OKX).

## 10. Credentials (passphrase) — DB + crypto + UI

- **Schéma** (`packages/db/src/schema.ts`, table `api_credentials`) : ajouter
  `passphraseEnc: text('passphrase_enc')` **nullable** (migration Drizzle additive).
- **Service** (`credentials.ts`) : `set(name, apiKey, secret, passphrase)`,
  `get()` renvoie `{ apiKey, secret, passphrase }`. Type `OkxCredentials` remplace
  `BinanceCredentials`.
- **Chiffrement** : inchangé (AES-256-GCM via `MASTER_KEY`), on chiffre la passphrase comme
  le reste.
- **UI Settings** : 3 champs (API key, secret, **passphrase**) par jeu de clés `live` /
  `demo` ; toggle « compte démo ». Plus de solde BNB affiché ; afficher le **palier OKX**
  (`level`) et les taux maker/taker réels (issus de `trade-fee`).

## 11. Modèle de frais OKX (`packages/shared/src/fees.ts`)

OKX n'a **pas** d'équivalent BNB (pas de toggle « payer les frais en token pour −X% »).
Détenir de l'OKB ne fait que **monter le palier** (automatique). Donc :

- **Suppression de `bnbDiscount`** et de `BNB_DISCOUNT`. `effectiveFeeRate(cfg, maker)`
  renvoie simplement `maker ? cfg.makerRate : cfg.takerRate`.
- `FeeConfig` = `{ makerRate, takerRate }`.
- **Défauts OKX Regular** (cadre global, en vigueur 25/11/2025) :
  ```ts
  DEFAULT_FEES = {
    spot:    { makerRate: 0.0008, takerRate: 0.0010 },
    futures: { makerRate: 0.0002, takerRate: 0.0005 },
  }
  ```
- **Backtest — presets de paliers** (sélection + override manuel maker/taker) :
  presets Regular / VIP1 / VIP2 / VIP3 / VIP4 / VIP5 avec les taux publiés (spot et perp),
  marqués « barème indicatif, varie selon région/période ».
- **Live — taux réels** : `GET /api/v5/account/trade-fee?instType=SPOT|SWAP&instId=…`
  renvoie `maker`/`taker` (et `makerU`/`takerU` pour les perps USDT-margés) **+ `level`**.
  Bouton UI « importer mes vrais taux » qui pré-remplit les défauts backtest. Le live
  utilise ces taux automatiquement (comme `commissionRates()` le faisait pour Binance).
- **Impact `simExchange`/`liveAdapter`** : suivre les appels à `effectiveFeeRate(..., market, ...)`
  et retirer l'argument `market` devenu inutile.

> Note : le `Fill.feeAsset` peut désormais valoir la quote/base OKX ; le champ reste
> générique. La normalisation quote se fait dans `feeToQuote`.

## 12. Tests

- **Unitaires** : signature REST OKX (vecteur connu prehash→sign), signature login WS,
  conversion base↔contrats (`ctVal`), génération de `clOrdId` (alphanumérique ≤32),
  mapping types d'ordres, `mapStatus` OKX, `effectiveFeeRate` (plus de BNB).
- **Mapping symbole** : `BTCUSDT`→`BTC-USDT`/`BTC-USDT-SWAP` et l'inverse.
- **Parsing** : enveloppe `{code,data}`, fills (`fillSz`/`fillPx`/`fee` signé/`pnl`),
  positions (contrats→base).
- **Non-régression** : la suite existante (67 tests) doit rester verte ; le backtester et
  les feeds Binance ne changent pas de comportement (hors retrait de `bnbDiscount`).
- **Smoke démo** (manuel, hors CI) : sur compte démo OKX, placer/annuler un ordre, vérifier
  réception du fill via WS privé et l'attribution au bot.

## 13. Plan de cutover (phases)

Chaque phase finit avec **typecheck + tests verts**.

1. **Abstraction + fees** : interfaces `ExchangeAccountClient`/`ExchangePrivateStream` ;
   `fees.ts` OKX (retrait BNB) + propagation des appelants. (Pas encore de réseau OKX.)
2. **REST OKX** : `okx/rest.ts` (auth/signing/démo), `okx/endpoints.ts`, `okx/instruments.ts`
   (meta + mapping symbole), `okx/account.ts` (balances, positions, orders, algo, leverage,
   trade-fee). Tests unitaires signing/mapping/contrats.
3. **WS privé OKX** : `okx/privateWs.ts` (login, souscriptions, ping, reconnect) +
   `OKXUserStreamRouter`.
4. **Adapter live** : `OKXLiveAdapter` (submit/cancel/fills/position/PnL/reconcile),
   wiring `botManager` (instId, levier/marge OKX, routeur unique par compte).
5. **Credentials + UI** : migration `passphrase_enc`, `credentials.ts`, Settings
   (passphrase, toggle démo, affichage palier+frais, bouton import taux).
6. **Nettoyage** : suppression `BinanceAccount`/`BinanceUserStream`/signing Binance inutilisé ;
   revue des mentions « Binance » côté trading ; mise à jour docs/README. Tests finaux.

## 14. Risques & points à confirmer

- **Accès `data.binance.vision` depuis le VPS** : confirmer (un `wget`) que le CDN statique
  échappe au géo-blocage 451 dans la région du VPS. Sinon, prévoir un egress non restreint.
  (Le code a déjà un failover 451 vers `data-api.binance.vision` côté public.)
- **`feeCcy` spot OKX** : sur un achat spot market sizé en quote, vérifier en démo dans quelle
  devise les frais sont prélevés (base vs quote) pour la normalisation.
- **Précision `ctVal`** : lire par instrument (varie) ; ne jamais coder en dur.
- **Changement d'API OKX** annoncé « effective June 9 & 11, 2026 » : relire avant le cutover.
- **`pnl` perp** dans les events de fill : confirmer la sémantique (réalisé sur réduction)
  pour aligner `realizedNet`.
- **Propagation du `clOrdId` au déclenchement d'un ordre algo (stop/TP)** : quand un ordre
  algo se déclenche, OKX place un NOUVEL ordre régulier pour exécuter le fill. `reconcile()`
  ré-adopte désormais les ordres algo au repos (clé = `algoClOrdId`), mais il faut **confirmer
  en démo** que l'ordre régulier déclenché porte bien notre préfixe `clOrdId` sur le canal
  `orders`. Si OKX assigne un `clOrdId` frais sans préfixe, le fill du stop déclenché pourrait
  rester non attribué (`handleOrderEvent` early-return). Risque résiduel honnête — à vérifier.

## 15. Décisions actées

1. Données = **Binance partout** (conservées) ; exécution = **OKX uniquement**.
2. Mode position perp = **net / one-way**.
3. Frais : défauts OKX Regular + **presets paliers éditables** + **import des taux réels**
   en live ; suppression de `bnbDiscount`.
4. `testnet` → **compte démo OKX** (`x-simulated-trading: 1`).
5. Abstraction `ExchangeExecution` extraite, **sans** sélecteur multi-exchange dans l'UI.
