# Incident live — btc-accumulator : fill d'algo perdu → désync → 51008 (2026-07-14)

**Gravité** : sérieuse (argent réel, désynchronisation du grand-livre). **Fonds** :
tous présents, aucun vol/perte au-delà du whipsaw normal. **État au moment de
l'écriture** : kill switch activé par Mario, aucune modif VPS ce soir (décision :
attendre revue à froid le 2026-07-15). Ce document = passation complète.

> RÈGLE tenue : investigation 100 % lecture seule (SSH + `docker exec` + API OKX
> GET uniquement). Aucun ordre, aucun write, aucune reprise. La `MASTER_KEY` n'a
> jamais quitté le conteneur ni été affichée.

## TL;DR

`btc-accumulator` (spot BTC-USDC, **live réel**) a vendu sa position puis son
**stop-bracket de rachat s'est déclenché et exécuté sur OKX** — mais le bot **n'a
pas ingéré ce fill** (OKX ré-étiquette l'ordre déclenché avec un clOrdId `O…`
maison, non reconnu par le bot). Se croyant encore en cash, le bot a tenté un
**second rachat au marché** → `51008 solde insuffisant` (le compte était déjà
vidé par le rachat qu'il n'avait pas vu) → gel de sécurité (`status=error`), puis
kill switch manuel. Le grand-livre du bot est désynchronisé de la réalité ; le
garde-fou a bien empêché un double-achat.

## Vérité terrain OKX (API, lecture seule, EEA — `eea.okx.com`)

Solde réel du compte au 2026-07-14 :

| Actif | Dispo | Gelé |
|---|---|---|
| BTC | 0.39536819 | 0 |
| ETH | 3.99664896 | 0 |
| USDC | 62.56 | 0 |

Historique d'ordres SPOT (BTC-USDC) pertinents :

| Heure UTC | Côté | Type | clOrdId | ordId | Rempli | avgPx | État OKX |
|---|---|---|---|---|---|---|---|
| 2026-07-13 20:00:00 | SELL | market | `tpx7f8b10camrgg3s3u1` | 3740325969422852096 | 0.20151586 | 62229 | filled |
| 2026-07-14 12:58:17 | BUY | market | **`O3742376051209254912`** | 3742376053849333760 | **0.19453319** | 63915.6 | **filled** |

L'ordre `O3742…` est le **market engendré par le stop-bracket déclenché** — clOrdId
**généré par OKX**, sans notre préfixe `tpx`.

## Ce que le bot croit vs la réalité (réconciliation exacte)

`bot_state` (VPS Postgres) :
- **btc-accumulator** : `posQty 0`, `quoteLedger 12496.24`, `bracket true`, `stop 63909.1`, `soldPrice 62288.23`, `realizedNet -455.18` → **FAUX**
- btc-vrx : `posQty 0.20151586`, `quoteLedger 0` → correct
- eth-accumulator : `posQty 3.996648`, `quoteLedger 0` → correct

Répartition réelle du BTC : `0.20151586 (vrx) + 0.19385233 (accum réel) = 0.39536819`
= **exactement** le solde on-chain. (accum réel = 0.19453319 brut − ~0.00068 de
frais pris en BTC.)

| | btc-accumulator croit | réalité |
|---|---|---|
| BTC | 0 | ~0.19385 |
| USDC | 12 496.24 | 62.56 |

**Seul btc-accumulator est désynchronisé** — d'un montant qui est exactement le
rachat manqué. vrx et eth sont justes.

## Table `orders` du bot (VPS) — la contradiction

| client_id | exchange_order_id | side | type | status | qty | stop |
|---|---|---|---|---|---|---|
| `…u1` | 3740325969422852096 | SELL | MARKET | FILLED | 0.201516 | |
| `…u2` | 3740325983287758848 | BUY | STOP_MARKET | **CANCELED** | 0.194554 | 63909.1 |
| `…u3` | (aucun) | BUY | MARKET | **REJECTED** | 0.193010 | |

- `…u2` (bracket) : `exchange_order_id` = l'**algoId**. Le bot le croit CANCELED,
  mais sur OKX il s'est **déclenché** et a produit le fill `O3742…` (0.19453 BTC).
- `…u3` (rachat EMA) : jamais arrivé sur OKX (rejet 51008) → n'apparaît pas dans
  l'historique OKX. C'est l'ordre qui a levé l'erreur et gelé le bot.
- Table `fills` du bot : **ne contient que la vente**. Le rachat `O3742…` est absent.

## Chronologie reconstruite

1. **13/07 20:00** — signal baissier → `btc-accumulator` VEND 0.20151586 BTC → ~12 496 USDC. `onFill` arme un **stop-bracket BUY** (algo `…u2`, seuil 63 909).
2. **14/07 12:58:17** — le prix touche 63 909 → **le stop se déclenche et s'exécute** : OKX achète 0.19453 BTC pour ~12 434 USDC via un ordre au clOrdId `O3742…`. **Le bot ne reconnaît pas ce clOrdId → fill jeté.** Le bot se croit toujours en cash (12 496 USDC, bracket pendant).
3. **14/07 (bougie suivante)** — la logique de rachat sur recroisement EMA se déclenche : `cancelAll()` (le bot « annule » l'algo — déjà déclenché, d'où CANCELED en base) puis **market BUY de 12 496 USDC** (`…u3`). Solde réel = 62 USDC → **51008** → `onStrategyError` → `status=error` + Telegram.
4. Mario : kill switch manuel.

## CAUSE RACINE (niveau plateforme, pas stratégie)

`apps/backend/src/services/okxLiveAdapter.ts:481-483` — `handleOrderEvent` :
```
const order = this.orders.get(ev.clOrdId)   // map indexée par clOrdId
if (!order) return                          // clOrdId "O…" inconnu → fill JETÉ
```
et le routeur multi-bots (`~ligne 802`) route par **préfixe de clOrdId**
(`clientId.startsWith(prefix)`) : `O3742…` ne matche aucun bot → l'event n'atteint
même pas l'adaptateur.

**Le code documentait déjà ce risque** (lignes 471-479, « RESIDUAL RISK — confirm
in demo, spec §14 ») : quand un algo se déclenche, OKX place un NOUVEL ordre
régulier pour le fill ; on pariait qu'il porterait notre préfixe `clOrdId`. **OKX
lui assigne en fait un clOrdId frais `O…`** → le fill est jeté. Le filet de
sécurité prévu (reconcile au redémarrage via `getAlgoOrder`) **n'a pas joué** car
la stratégie a `cancelAll()` l'algo et le bot a gelé AVANT tout reconcile.

Facteur aggravant `packages/data/src/okx/types.ts:41-59` : `OkxOrderEvent`
n'expose **ni `algoId` ni `algoClOrdId`** — même en le voulant, le code ne peut
pas aujourd'hui rattacher le fill à l'algo par un autre identifiant.

## Portée — quelles stratégies sont exposées

Le bug est dans **l'adaptateur OKX partagé**, donc il touche **toute stratégie qui
pose des ordres à déclenchement** (stop/trigger) :

| Stratégie | Ordres à déclenchement | Exposée ? |
|---|---|---|
| btc-accumulator | `stopMarket` (rachat bracket) | **OUI — a explosé** |
| eth-accumulator | `stopMarket` (même bracket, ligne 211) | **OUI — latent**, explosera au 1ᵉʳ déclenchement du rachat |
| btc-swing | `stopMarket` + `limit` (ligne 218) | **OUI si déployé** (pas live actuellement) |
| btc-vrx | market uniquement | **NON — immunisé** |

→ eth-accumulator tourne AUSSI en live avec exactement le même mécanisme ; il n'a
juste pas encore déclenché son stop de rachat. À traiter comme une bombe à retardement.

## Correctif proposé (À VALIDER — rien appliqué)

**A. Attribution des fills d'algo par identifiant d'algo (cœur du fix)**
1. Ajouter `algoId?` et `algoClOrdId?` à `OkxOrderEvent` et les parser depuis le
   push WS brut du canal `orders`.
2. `handleOrderEvent` + routeur : à défaut de match sur `clOrdId`, matcher sur
   `algoClOrdId` (devrait porter notre préfixe `tpx…u2`) puis sur `algoId`
   (comparé à `order.exchangeOrderId`, déjà = `ack.algoId` à la pose, ligne 348).
   Ajouter un index secondaire `algoId → order`.

**B. Durcir l'annulation d'algo** : avant de marquer un algo CANCELED, lire son
état final ; s'il est `effective` (déclenché), **backfiller le fill de l'ordre
engendré** (`getAlgoOrder → ordId → fills`) avant de conclure. Filet même si le WS
rate le push.

**C. Détection de dérive de solde** : aujourd'hui `okxLiveAdapter` clampe
silencieusement `quoteLedger` vers le bas (ligne ~260). Ajouter une **détection**
qui gèle + alerte si le solde réel diverge du grand-livre au-delà d'un seuil —
aurait attrapé « livre 12 496 USDC vs réel 62 » immédiatement.

**D. Stratégie accumulateur** (2 points) :
   - Marge de frais sur le rachat au marché : `btc-accumulator.ts:259` dépense
     `quoteQty: usdt` (100 %) sans marge, alors que le bracket garde `*0.995`
     (ligne 274). Aligner à `*0.995`.
   - **Deux chemins de rachat concurrents** : le bracket `stopMarket` (onFill) ET
     le market sur recroisement EMA (onCandle) visent le même cash. Le 2ᵉ ne doit
     pas tirer tant que l'état du bracket n'est pas réconcilié. C'est la course qui
     a transformé un fill manqué en ordre en double.

**E. Vérif démo (spec §14)** : confirmer EXACTEMENT les champs envoyés par OKX sur
le canal `orders` pour un algo déclenché (porte-t-il `algoClOrdId` avec notre
préfixe, ou seulement `algoId` + clOrdId `O…` ?). Décide si A.2 suffit via le
préfixe ou impose l'index `algoId`.

## Récupération recommandée (NE PAS exécuter sans revue)

1. Rester killé.
2. **Re-synchroniser le livre de btc-accumulator sur la réalité** : `posQty ≈
   0.19385`, `posEntry ≈ 63915`, `quoteLedger ≈ 62.56`, `bracket=false`, effacer
   `soldPrice` et l'état `error`.
3. Déployer le correctif A (+ B/C/D) et re-tester en démo.
4. Redémarrage contrôlé ; vérifier que le reconcile colle au solde OKX.
5. Auditer eth-accumulator (même code) avant de le laisser déclencher un rachat.

## Dégât économique réel

Whipsaw normal de la stratégie (pas le bug) : vendu 0.20151586 @ 62 229, racheté
0.19385 @ 63 915 → **perte ≈ 0.00766 BTC (~3.8 % de la part, ~490 USDC)**. Le prix
est remonté après la vente ; la stratégie a été prise à contre-pied. Rien d'autre
n'est perdu — tous les fonds sont sur le compte.

## Empreinte de l'investigation (traçabilité)

- Accès : `ssh root@45.32.123.66` (lecture) ; `docker exec` psql (SELECT only) ;
  script jetable `okx_check.mjs` (4 GET OKX : balance, asset/balances, fills,
  orders-history) exécuté DANS le conteneur puis supprimé.
- Découverte annexe : les clés live sont sur la **région EEA** — un appel vers
  `www.okx.com` renvoie `50119 API key doesn't exist` ; il FAUT `eea.okx.com`
  (piloté par `OKX_REGION=eea`, déjà correct côté bot).
