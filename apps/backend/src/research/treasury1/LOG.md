# Campagne treasury1 — gestion du capital bots × carry (2026-07-12)

**Mission** (GO Mario) : le cash USDT des bots d'accumulation dort entre la
vente d'une tranche (en force) et son rachat (dans le creux). Trois politiques
de capital à départager, chiffres en main :

- **A. Statu quo** : le cash dormant ne rapporte rien.
- **B. Poche dédiée** : x % du capital initial retiré des bots et placé au
  carry en permanence (hold, cf. carry1) — x ∈ {10, 20, 30 %}, figé ici.
- **C. Poche recyclée (idée Mario)** : les bots gardent 100 % du capital ; le
  produit de CHAQUE tranche vendue est parqué au carry pendant sa fenêtre
  d'attente, débouclé au rachat. Variantes figées : parcage immédiat (naïf),
  après 7 j d'attente, après 30 j (l'attente évite de payer le péage sur les
  rachats rapides).

## Hypothèses PRÉ-ENREGISTRÉES (avant toute mesure)

- **Simulation** : moteur produit réel (`runBacktest`), stratégies LIVE avec
  leurs défauts produit — btc-accumulator (BTCUSDT), btc-vrx (BTCUSDT),
  eth-accumulator (ETHUSDT) — spot, denomination=base, 1 coin initial, frais
  DEFAULT_FEES + slippage 0,05 %, période 2020-08-01 → 2026-06-01 (couverte
  par le funding exact en base).
- **Fenêtres de cash** : par tranche, [entryTime, exitTime) du TradeRecord,
  montant = qty × avgEntryPrice (produit de la vente) ; tranches encore
  ouvertes = jusqu'à la fin de période.
- **Comptabilité carry** (héritée carry1) : funding exact par événement de la
  venue Binance du même coin, agrégé daily ; net efficace ×0,83 ; **péage
  0,4 % par cycle de parcage** (0,2 % entrée + 0,2 % sortie) ; pas de yield le
  jour d'entrée.
- **Conversion CONSERVATRICE** : le yield s'accumule en USDT hors bot et
  n'est converti en coin qu'à la FIN de la période, au dernier close (pas de
  DCA opportuniste dans les creux — variante produit possible mais non
  mesurée ici).
- **Métriques** : richesse finale totale en COIN (l'unité des bots) et uplift
  vs A ; équivalent %/an sur la richesse moyenne ; par variante C : nb de
  cycles, durée médiane de parcage, % de cycles perdants (péage > yield),
  péages totaux vs yield brut. Pour B : le coin final des bots est supposé
  proportionnel au capital (stratégies en % — vérifié à ±0 par la nature des
  tranches) → total = bots×(1−x) + poche carry convertie fin de période.
- **Barre de décision** : la politique gagnante doit battre A d'au moins
  **+0,5 %/an équivalent** sur la richesse moyenne pour justifier de la
  plomberie ; entre B et C, la plus simple gagne à écart < 0,3 %/an.

## Plan

- [x] 1. extract_cash.ts — sim des 3 bots live, dump des tranches (JSON).
      Fait : btc-accumulator 49 tranches (×1,8195 BTC), btc-vrx 57 (×2,2619),
      eth-accumulator 33 (×1,7040), 2020-08→2026-06, défauts produit.
- [x] 2. treasury_study.py — politiques A/B/C selon les hypothèses.
- [x] 3. Verdict : **A (statu quo) gagne partout — idée close.**

## Résultats (2026-07-12, hypothèses appliquées telles quelles)

| Bot | cash dormant moyen | C d+0 (équiv./an) | C d+7 | C d+30 | B 10 % | B 30 % |
|---|---|---|---|---|---|---|
| btc-accumulator | 17,9 % | **-2,99 %** (46/46 cycles perdants) | -0,73 % (11/11) | 0 cycle | -2,59 % | -7,76 % |
| btc-vrx | 29,2 % | **-4,26 %** (55/55) | -1,45 % (18/18) | 0 cycle | -3,36 % | -10,07 % |
| eth-accumulator | 10,6 % | **-2,99 %** (32/32) | -0,65 % (7/7) | 0 cycle | -2,27 % | -6,81 % |

Pourquoi c'est si net :

1. **La durée médiane de parcage est de 4 jours** (3-7 selon bot/variante) —
   l'excursion rachète VITE. 4 jours de funding ≈ 0,05-0,15 % de yield contre
   0,4 % de péage : **100 % des cycles sont perdants, sur les 3 bots et
   toutes les variantes.** Le d+30 ne parque plus rien du tout (aucune
   tranche n'attend 30 j… sauf celles du bear).
2. **Les longues attentes tombent dans les régimes à funding pauvre** : le
   bot attend longtemps quand le marché est bear/chop — précisément quand le
   carry ne paie pas. L'intuition « vendu en euphorie → funding riche pendant
   l'attente » est vraie mais l'attente y dure 4 jours : le péage domine.
   Pire des deux mondes, symétrique de l'espoir initial.
3. **B (poche dédiée) perd des coins massivement sur cet échantillon** : la
   poche fait ×1,75 en USDT pendant que BTC fait ×6,05 → en unité coin (la
   nôtre), chaque % dédié au carry coûte ~0,26 %/an de richesse par % alloué.
   ⚠ verdict DÉPENDANT DU RÉGIME : sur un échantillon bear, B gagnerait des
   coins — mais parier là-dessus = market timing, qu'on ne fait pas. Le
   verdict de C, lui, est structurel (péages vs fenêtres courtes), robuste
   à tous les régimes.

**VERDICT : les bots gardent 100 % de leur capital, cash dormant compris —
aucune tuyauterie bots↔carry.** Le carry n'a de sens qu'en poche SÉPARÉE,
jugée dans SA devise (USDT/EUR — rendement stable), dimensionnée par
l'appétit de rendement stable, en sachant qu'elle sous-performera le coin
en bull. Les deux moteurs ne partagent ni capital ni unité de compte.
Barre pré-enregistrée (+0,5 %/an requis) : aucune politique ne l'approche.

## Journal

- 2026-07-12 : campagne ouverte, hypothèses figées avant toute mesure.
- 2026-07-12 (suite) : sims + étude exécutées. Idée « recycler le cash
  dormant » RÉFUTÉE proprement (médiane 4 j vs péage 0,4 %) ; poche dédiée
  perdante en coin sur échantillon bull-heavy. Statu quo optimal. Campagne
  close en une session.
