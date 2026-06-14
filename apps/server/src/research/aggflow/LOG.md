# Journal de recherche — Edge de flux sur aggTrades

> Trace vivante de l'investigation. Mise à jour à chaque étape. Lis ce fichier pour savoir où on en est.

## Contexte & question

Le doc `CONTEXT_edge_aggtrades.md` propose de chercher un edge dans les **aggTrades** Binance
(flux signé au trade via `isBuyerMaker`), notamment le **CVD stratifié par taille** (baleine vs retail).

**On exploite déjà** une version grossière : `takerFlow = takerBuyBase/volume` **par bougie**.
La vraie question n'est donc PAS « le flux a-t-il un edge » mais :

> **Le flux au niveau du TRADE (et sa stratification par taille) prédit-il le rendement forward
> AU-DELÀ du taker-flow par bougie qu'on a déjà ?**

Si non → pas la peine d'investir dans le pipeline/walk-forward. Si oui → on creuse.

## Hypothèse causale (à réfuter, pas à confirmer)

H1 : le **flux net signé** (delta = vol acheteur agressif − vol vendeur agressif) sur une barre prédit
le rendement des barres suivantes (continuation à court horizon).
H2 (le pari du doc) : le **flux des gros trades** (baleine) prédit MIEUX que le flux retail, et surtout
**au-delà** du flux agrégé. Scepticisme noté : les informés fractionnent leurs ordres (algos/iceberg)
→ « gros trade = informé » peut être naïf. C'est précisément ce qu'on teste.

## Méthode (étape 3 = corrélation, pas encore backtest)

Par barre (1h) sur BTCUSDT spot, depuis le stream aggTrades :
- `delta` = Σ qty·(isBuyerMaker ? −1 : +1) ; et `deltaWhale/deltaMid/deltaRetail` par bucket notionnel.
- `flowImb = delta/volume` (≡ 2·takerFlow − 1, donc **le contrôle = notre indicateur actuel**).
- `whaleImb = deltaWhale/volume`, etc.
- Rendements forward `fwd_k = ln(close[i+k]/close[i])`, k ∈ {1,4,12} barres.

Mesures clés :
1. `corr(flowImb, fwd_k)` — baseline (flux agrégé prédit-il ?).
2. `corr(whaleImb, fwd_k)` vs `corr(retailImb, fwd_k)` — la baleine prédit-elle mieux ?
3. **`partial_corr(whaleImb, fwd_k | flowImb)`** — LA question : la baleine ajoute-t-elle au-delà du flux agrégé ?
4. `corr(whaleImb − retailImb, fwd_k)` — divergence baleine/retail.
+ sanity : `corr(flowImb, ret_contemporain)` doit être > 0 (le flux pousse le prix dans la barre).

Buckets notionnels BTC : retail < 10 k$, mid 10–100 k$, whale > 100 k$. Fenêtre : ~3 semaines 2024
(régime mixte). In-sample uniquement — c'est un test de réfutation rapide, pas une validation.

## Critère de décision (go / no-go)

- **NO-GO** si la corrélation partielle whale-au-delà-du-flux est ~0 sur tous les horizons (le trade-level
  n'ajoute rien à ce qu'on a déjà).
- **Signe encourageant** si `partial_corr(whaleImb | flowImb)` est non négligeable et cohérent entre horizons,
  ET si baleine > retail. Alors → étendre la fenêtre, walk-forward propre, deflated Sharpe.

---

## Statut

- [x] §0 Mise en place journal + tâches
- [x] §1 Script de corrélation écrit (`corr.ts`)
- [x] §2 Smoke 3 j OK ; run 3 semaines 1h + 15 min OK
- [x] §3 Verdict : **NO-GO** sur la thèse linéaire (voir Résultats)

## Données

- aggtrade_files au départ : **VIDE** (rien en cache) → le 1er run télécharge depuis data.binance.vision.
- Fenêtre choisie : 2024-10-25 → 2024-11-15 (spot BTCUSDT), barres 1h.

## Résultats

**Smoke 3 jours (72 barres, 6,7 M trades, 1h)** — NE PAS s'y fier : hints (mean-reversion du flux,
fade-retail, baleine−retail à +12 = +0,18**) qui ont DISPARU sur l'échantillon plus grand. Illustration
parfaite du piège small-sample + fenêtres chevauchantes (le `**` était gonflé par l'autocorrélation).

**Run 3 semaines, 2024-10-25→2024-11-15 (BTCUSDT spot, 44,9 M trades) :**

| barres | sanity corr(flux, ret_contemp) | meilleur \|corr forward\| | baleine \| flux net (partielle) |
|---|---|---|---|
| 1h (504 barres)  | +0,465 ✓ | ~0,04 (aucune étoile) | +0,003 / +0,007 / +0,009 ≈ **0** |
| 15min (2016 barres) | +0,475 ✓ | ~0,04 (qq * p<.10 à fwd+4) | +0,009 / +0,005 / −0,010 ≈ **0** |

- **Aucune prédictivité forward** du flux : meilleur \|r\| ≈ 0,04 → R² ≈ 0,2 %, économiquement nul
  (mangé par frais+spread). Les rares `*` (mean-reversion légère ~1h, divergence/absorption) sont
  infimes et suspects (fenêtres forward chevauchantes gonflent la significativité).
- **La stratification par taille n'apporte RIEN** au-delà du taker-flow par bougie qu'on a déjà :
  corrélation partielle baleine \| flux-net ≈ ±0,01 sur tous les horizons et toutes les résolutions.
  → L'idée phare du doc (« CVD baleine vs retail, outside the box ») = zéro valeur marginale ICI.
- Le flux net bouge bien le prix DANS la barre (sanity +0,47) mais ne dit rien sur la suite.

## Décision : NO-GO (sur la thèse linéaire simple)

Ne PAS investir dans le pipeline lourd de CVD stratifié comme priorité. Le `takerFlow` candle qu'on
exploite déjà capture le peu de signal de flux linéaire qui existe (et ce signal forward est ~nul).
Construire l'infra trade-level pour répliquer ça n'a pas de retour ici.

**Caveats honnêtes (ce que ce test NE dit PAS) :**
1. Une seule fenêtre (3 sem.), régime de **rally fort** 2024 — un régime de cascade de liquidations
   (bear violent) pourrait différer.
2. **Spot** seulement — le flux/levier/liquidations vivent surtout sur le **perp (futures)**.
3. Corrélation **linéaire** seule — un edge **conditionnel** (flux × régime funding/OI, à la §6 du doc)
   n'est pas testé. C'est justement l'architecture multi-échelle que le doc recommande.

**Donc :** « pas d'edge linéaire simple ici », pas « aucun edge n'existe ». Si on veut tirer le fil :
- Le vrai actionnable bon-marché, à faire MAINTENANT : **logger OI + ratios long/short** (API ~30 j
  d'historique, non-backfillable) → dans quelques mois on pourra tester le flux CONDITIONNÉ au régime.
- Sinon : refaire le test sur **perp** + une fenêtre de **bear/liquidations**, et en **conditionnel**
  (flux seulement quand funding extrême), avant tout backtest.

## Reproduire

```
bun apps/server/src/research/aggflow/corr.ts 2024-10-25 2024-11-15 60   # 1h
bun apps/server/src/research/aggflow/corr.ts 2024-10-25 2024-11-15 15   # 15min
```
(aggTrades de cette fenêtre désormais en cache local). NB : Bun jette parfois un
`UNKNOWN_CERTIFICATE_VERIFICATION_ERROR` transitoire sur le 1er fichier Vision → relancer.

## Décisions & notes

- 2026-06-14 : étape 3 faite. Verdict NO-GO sur la thèse linéaire. Coût = ~45 M trades téléchargés (cache).
