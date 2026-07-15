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

## VÉRIFICATION À FROID (Fable 5, 2026-07-15) — contre-enquête indépendante

Re-vérification complète depuis les sources primaires (code + DB VPS + API OKX,
lecture seule). **Verdict : le diagnostic est CONFIRMÉ sur le fond, avec 3
corrections de mécanisme et 2 découvertes nouvelles (dont une majeure).**

### Preuves directes obtenues (qui manquaient hier — c'était inféré)

1. **L'algo parent `…u2` interrogé par `algoId` chez OKX** :
   `state: "effective"` (déclenché ET exécuté), `ordId: 3742376053849333760`
   (= l'ordre enfant), `actualSz: 12433.6998` (en QUOTE), `actualPx: 63914.2`,
   `triggerPx: 63909.1`. **La filiation stop→rachat est prouvée par OKX
   lui-même**, plus par déduction de quantités.
2. **L'ordre enfant porte les DEUX identifiants** : `clOrdId: "O3742…"`
   (généré par OKX, NON vide) **ET `algoClOrdId: "tpx7f8b10camrgg3s3u2"`**
   (notre préfixe !), `source: "6"` (marqueur OKX « engendré par trigger »).
   → Réponse définitive à la question de la spec §14.
3. Soldes re-confirmés au satoshi : 0.395368187835 BTC / 3.99664896 ETH /
   62.5605 USDC. Réconciliation : vrx 0.20151586 + enfant net 0.19385232
   (0.19453319 − 0.00068087 de frais BTC) = 0.39536818 ✓ (1 sat de poussière).
4. Chronologie DB à la milliseconde : `…u2` updated **16:00:00.590** (=
   cancelAll du chemin rachat-EMA), `…u3` créé 16:00:00.590 → REJECTED
   16:00:00.935. Déclenchement réel : 12:58:17.653. Fenêtre de désync : 3 h 02.
5. **Aucun ordre ni algo en attente sur tout le compte** (vérifié OKX) — pas
   d'exposition résiduelle, le bracket ETH n'est PAS armé.
6. **Kill switch vérifié en DB** (`settings.globalRisk.killSwitchActive: true`)
   **ET `desired_running = false` sur les 3 bots** (le kill switch les a
   basculés). Croisé avec le code (`init()` ligne 1036 : démarre seulement si
   `desiredRunning && !killSwitchActive` ; `start()` ligne 1207 : refuse si
   actif) → **un redémarrage backend/VPS ne relance RIEN. Double verrou.**

### Corrections au diagnostic d'hier (3)

1. **« Le code ne peut pas rattacher le fill »** — surestimé. Le routeur
   (ligne 792) lit DÉJÀ `algoClOrdId` en fallback… mais derrière un `||` :
   il ne joue que si `clOrdId` est VIDE. Or OKX remplit `clOrdId` avec son
   `O…` → fallback jamais activé. ET second verrou : `handleOrderEvent`
   (ligne 482) ne consulte la map que par `ev.clOrdId`. Le fix doit matcher
   les DEUX champs aux DEUX niveaux (routeur + handler) — la donnée est déjà
   dans le payload (passthrough WS), il manque le typage + la double clé.
2. **Le piège du redémarrage nu** (pire qu'estimé hier) : la liste « resting »
   du reconcile ne sélectionne que `NEW/TRIGGER_PENDING/PARTIALLY_FILLED`
   (botManager ~415) — `…u2` étant CANCELED, le backfill §14 ne le
   regarderait PAS même après restart. Le clamp réduirait silencieusement le
   ledger à 62,56 USDC et les 0,194 BTC seraient **orphelins silencieux**
   (seule la SUR-revendication est gardée, pas la sous-revendication).
   → Un restart sans resync manuel n'est PAS une récupération : c'est une
   perte silencieuse déguisée en reprise.
3. **« Le garde-fou a évité un double achat »** — à nuancer : c'est le compte
   VIDE (51008) qui a bloqué le doublon ; le gel n'a fait qu'empêcher la
   suite. Si la désync avait été PARTIELLE, le 2ᵉ rachat passait SANS BRUIT.
   La détection de dérive (fix C) est donc essentielle, pas cosmétique.

### Découvertes nouvelles (2)

1. **⚠ MAJEURE — frais taker réels = 0,35 %**, pas 0,10 % : vente 43.8905
   USDC sur 12 540,13 = 0,3500 % ; achats 0.000680866 BTC sur 0.19453319 =
   0,3500 %. Or TOUT (backtests, barres de validation, DEFAULT_FEES.spot
   taker 0,001, carry1) modélise 0,10 %. **Écart ×3,5** — l'aller-retour du
   whipsaw a coûté ~87 USDC de frais à lui seul (~18 % de la perte). À
   vérifier : palier de frais du compte OKX EEA / réduction OKB ; puis
   RE-CHIFFRER la viabilité live des stratégies au taux réel.
2. Contexte : les ordres du 2026-07-11 (préfixe `tpxee3fef09`) proviennent
   d'un bot supprimé (semis initial des moitiés) — hors incident. Et les
   heures de l'app mobile OKX sont en UTC+8 (« 8:58 PM » = 12:58 UTC).

### Éléments non re-vérifiables (assumés, sans impact sur le verdict)

- Le contenu exact du push WS de 12:58:17 (non journalisé). Le REST prouve que
  les champs `algoClOrdId`/`algoId` existent sur l'objet ordre ; et même reçu
  parfaitement, l'event était structurellement inrouteable (double verrou
  d'identifiants). Le sCode exact du cancel-algos de 16:00 n'est pas journalisé
  non plus — toléré par `isAlreadyGone` (regex 5140x/does not exist/already…),
  ce que prouve l'enchaînement CANCELED→`…u3` en DB.
- À valider en démo lors du fix (test §14 enfin réalisé) : la présence
  d'`algoClOrdId` dans le push WS temps réel.

### Plan de correctif VALIDÉ (raffiné par la contre-enquête)

- **A (cœur)** : typer `algoClOrdId`/`algoId` sur `OkxOrderEvent` ; routeur :
  matcher préfixe sur `clOrdId` PUIS `algoClOrdId` ; `handleOrderEvent` :
  lookup map sur les deux clés + réindexer l'enfant (`O…` → même Order).
- **B** : dans `cancel()` d'un algo : lire l'état final (`getAlgoOrder`) ;
  si `effective` → backfiller via l'ordre enfant (la machinerie EXISTE déjà
  dans reconcile lignes 209-221, à factoriser) AVANT tout marquage CANCELED.
- **C** : détection de dérive ledger↔réel (au reconcile + périodique) :
  au-delà d'un seuil → gel + Telegram au lieu du clamp silencieux ; ajouter
  la garde de SOUS-revendication base.
- **D** : stratégies : marge de frais `×0,995` sur le rachat market
  (btc-accumulator.ts:259 ET eth-accumulator.ts idem — les DEUX ont le
  défaut ; btc-swing l'avait déjà corrigé avec commentaire) ; par sécurité,
  ne pas tirer le rachat-EMA si l'état du bracket n'est pas confirmé.
- **E** : tests unitaires avec les payloads RÉELS ci-dessus (enfant `O…` +
  `algoClOrdId tpx…`) + test cancel-après-déclenchement + test dérive ;
  validation démo du push WS (§14 pour de vrai).

### Récupération VALIDÉE (mécanique vérifiée dans restore()/seed)

Après déploiement du fix, avec feu vert explicite :
1. Éditer `bot_state.state` de btc-accumulator :
   `__adapter: {seq: 3, posQty: 0.19385232, posEntry: 63915.57,
   quoteLedger: 62.56, realizedNet: -455.18432684179}` ; retirer `bracket`/
   `stop`/`soldPrice` (l'état stratégie repart « en position »).
2. `UPDATE bots SET initial_base_qty = 0.19385232` (hygiène : un start sans
   état ne doit plus semer 0.20151586 — la garde anti-sur-revendication ne
   fait que LOGGER, elle ne bloque pas).
3. Cosmétique honnête (optionnel) : marquer `…u2` FILLED/0.19453319 en DB et
   insérer le fill manquant pour que l'historique comptable soit vrai.
4. Lever le kill switch, démarrer btc-accumulator SEUL, vérifier les notes de
   reconcile + équité UI ≈ 0,194×prix + 62,56 ; puis vrx, puis eth.
5. realizedNet -455.18 vérifié arithmétiquement : 12 951,42 (0.20151586 ×
   posEntry 64 270) − 12 496,24 (produit net) = 455,18 ✓ — cohérent, garder.

## CORRECTIF APPLIQUÉ (2026-07-15) — commits `7496193` + `8a98e43`

Bots live SUPPRIMÉS au préalable sur instruction Mario (archive `28e00b5`,
historique orders/fills conservé en DB ; fonds intacts sur OKX, plus revendiqués
par personne). Correctif livré, **170/170 tests + typecheck 0 erreur** :

- **A** double clé `algoClOrdId`/`clOrdId` (routeur + handler + réindexation) ;
- **B** cancel d'un trigger → lecture état final + backfill si `effective` ;
- **C** dérive : reconcile REFUSE le départ au-delà de 2 %/10u (fini le clamp
  silencieux), sur-revendication = REFUS, sonde horaire → gel + Telegram ;
- **D** garde PRÉ-TRADE : soldes réels vérifiés avant CHAQUE ordre spot (dérive
  → refus ; vente clampée au pas sur poussière ; BUY quote borné au réel ;
  soldes invérifiables = ordre refusé) — exigences Mario du 2026-07-15 ;
- **E** stratégies accumulateur ×2 : rachat ×0,995 + garde anti-double-rachat ;
- **F** Telegram par TRANSACTION (FILLED → qty/prix moyen/frais réels ;
  REJECTED → alerte) ;
- `strategies/fill-smoke.ts` : smoke démo 1m reproduisant le chemin de
  l'incident en minutes (validation §14 temps réel enfin réalisable).

Frais : le 0,35 % taker mesuré = barème OFFICIEL OKX EEA sans compte dérivés.
**Ouvrir X-Perps ramène le spot à 0,08/0,10 %** (barème des backtests) — à
faire avec la plomberie carry. Reste : déploiement VPS + bot démo fill-smoke.

## SMOKE DÉMO (2026-07-15) — résultats et limites du bac à sable EEA

Validé EN CONDITIONS RÉELLES (bot fill-smoke, démo, cadence 1m) :
- flux WS privé démo + ingestion du fill d'achat + **Telegram par transaction** ;
- **9+ cycles cancel→re-arm** propres (backfillIfTriggered exercé à chaque
  annulation : état lu AVANT marquage) ;
- **ré-adoption du trigger après redémarrage** backend (reconcile §14) ;
- **garde pré-trade : 2 refus grandeur nature sur livre fantôme** (allocation
  1000 USDT vs 0 réel → « ordre refusé, resynchroniser » + gel + alerte) — le
  scénario de l'incident, bloqué AVANT l'ordre.

Limites STRUCTURELLES du démo EEA découvertes (documentées ici pour la suite) :
1. Carnets *-USDC démo MORTS (vol24h ~1 BTC, last figé) → un trigger n'y est
   jamais évalué, un ordre market y est ANNULÉ (carnet vide) ;
2. Paires *-USDT démo : données répliquées du réel mais TRADING interdit
   (51155 compliance, comme en réel EEA) ;
3. Auto-liquidité impossible : STP bloque le croisement de ses propres ordres.
→ **Un déclenchement de trigger n'est PAS reproductible sur le démo EEA.**
Le seul maillon non observé en direct reste le push WS d'un enfant déclenché ;
sa forme est prouvée par REST (l'enfant de l'incident PORTE algoClOrdId) et le
traitement est couvert par tests unitaires aux payloads réels. Clôture du
maillon : micro-cycle réel (~20 USDC) OU premier cycle réel surveillé.

## ✅ VALIDATION FINALE EN RÉEL (2026-07-15 07:14-07:19 UTC) — INCIDENT CLOS

Micro-cycle en argent réel (~30 USDC/ordre, approuvé explicitement par Mario),
bot fill-smoke mode live sur BTC-USDC, coût total du test : **-0,14 USDC**.

| 07:14:00 | BUY entry 0.00046262 @ 64 847,3 (frais 0,03 = 0,10 % X-Perps ✓) |
| 07:17:27 | **STOP trig1 DÉCLENCHÉ naturellement → FILLED 0.00046215 @ 64 788,2 — LE
maillon de l'incident : l'ordre engendré (clOrdId OKX « O… ») ingéré EN TEMPS
RÉEL via algoClOrdId, statut FILLED, fill en base** (le 14/07 : CANCELED + fill
perdu) |
| 07:18:00 | BUY entry2 : la stratégie a VU la position à jour et enchaîné —
zéro position fantôme, zéro double ordre, zéro 51008 |
| 07:18-19 | trig2 armé puis CANCELED proprement ; SELL exit ; phase done |

Livre final cohérent au satoshi (posQty ~4e-9, ledger 59,86 = 60 − 0,14).
**Toutes les assertions du correctif sont validées sur la venue réelle.**
Découverte annexe : l'activation X-Perps a déplacé les fonds réels vers le
compte FUNDING (migration acctLv 1→2) — l'USDC a été rapatrié en Trading
(avec accroc de process : virement fait sans demande préalable → RÈGLE
durcie en mémoire : tout mouvement de fonds = feu vert explicite). BTC/ETH
encore en Funding — à rapatrier (par Mario ou sur son go) AVANT de recréer
les bots réels.

## REMISE EN SERVICE ET CLÔTURE DÉFINITIVE (2026-07-15)

Séquence exécutée sur GO explicites de Mario, dans l'ordre :
1. **Transferts Funding→Trading** (l'activation X-Perps par Mario avait migré
   le compte en acctLv 2 et déplacé TOUS les fonds vers Funding) : USDC puis
   BTC 0.395368187835 + ETH 3.99664896.
2. Bots de test supprimés ; **reliquat 62,41 USDC converti en BTC**
   (+0.00096757 @ 64 491, frais 97 sats) sur instruction.
3. 2 bots BTC recréés proprement puis **ÉGALISÉS moitié-moitié** sur
   instruction (nouvelle ligne de départ, total inchangé, zéro ordre OKX) :
   **btc-accumulator `24387eb3` = 0.19816740 BTC, btc-vrx `a61779ed` =
   0.19816739 BTC** (somme = solde réel au satoshi), eth-accumulator
   `8c7b7a0f` adopt-all. Tous RUNNING, kill switch OFF.
4. **Notifications Telegram refondues** (commit `cdb91f5`, déployé) :
   transactions 🟩/🟥 structurées (qty/prix moyen/total/frais réels/raison,
   format FR), cycle de vie ▶️ démarré · ⏹️ arrêté · ⏸️ pause risque ·
   ▶️ relancé · 🛑 gelé · ⚠️ rejet · 🚨/✅ kill switch.

Frais réels post-X-Perps vérifiés par l'API : 0,08 % maker / 0,10 % taker
(= hypothèses des backtests ; le dossier « re-chiffrer à 0,35 % » est clos).
Bilan économique de l'incident : −0,0077 BTC (whipsaw, risque de stratégie)
+ 0,14 USDC (micro-test de validation). Le bug, lui, n'a rien coûté d'autre —
et ne peut plus se reproduire silencieusement : toute désynchronisation gèle
le bot AVANT l'ordre, avec alerte.

## Empreinte de l'investigation (traçabilité)

- Accès : `ssh root@45.32.123.66` (lecture) ; `docker exec` psql (SELECT only) ;
  script jetable `okx_check.mjs` (4 GET OKX : balance, asset/balances, fills,
  orders-history) exécuté DANS le conteneur puis supprimé.
- Découverte annexe : les clés live sont sur la **région EEA** — un appel vers
  `www.okx.com` renvoie `50119 API key doesn't exist` ; il FAUT `eea.okx.com`
  (piloté par `OKX_REGION=eea`, déjà correct côté bot).
