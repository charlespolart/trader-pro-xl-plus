# revalid1 — re-validation des 3 stratégies live + recherche d'amélioration (2026-10-07)

Mandat Mario (2026-10-07) : « refaire des backtests complets, essayer d'améliorer
les 3 stratégies live, pourquoi pas trouver de nouveaux edges ». Recherche PURE :
zéro touche au VPS / bots / config. Base recherche 5438 (Vision canonique),
BTC/ETH 4h-1d-3d-1w rafraîchis au 2026-10-07. Baselines accum2/baselinecheck
8/8 ✓ avant toute mesure (non-régression moteur+données).

## 0. Ce qui est DÉJÀ réfuté (ne pas re-tester sans angle NOUVEAU)

accum2 : 12 familles d'exit/filtre/sizing/cooldown/grain → v2 = optimum local.
accum3 : 122 features → 1 famille réelle (VRX) ; harvest, réversion 1j, hash
ribbon, ETH-vrx, grains 1h/1d, cap de perte VRX (neutre) réfutés.
accum4 : range/oscillateurs (à contresens), cross-market, sentiment alt.
accum5 : rotation satellite (2 looks OOS épuisés). accum6 : liquidations/OI.
ROADMAP : H1 cross-section, H2 carry/basis, H3 saisonnalités, H4 chartiste,
H6 flux, H8 pairs, H10 on-chain, H11 microstructure (coûts), H12 cross-venue,
H13 DVOL, N1 regime2, N2 volume, E1 OI, E6 LSR. Survivants : regime1 (H7),
listing2 (H9, retirée en marche à blanc 2026-09-18).
Vierges : H5 lead-lag ; H14 vol-target GLOBAL (« non exploré ») ; grain tick ⏸.

## 1. Protocole pré-enregistré

### 1.1 Mesure (pas une hypothèse) — fenêtre vierge
Rejouer btc-accumulator, btc-vrx, eth-accumulator (défauts produit, frais OKX
taker 0,10 % + slip 0,05 %, dénomination base) sur :
  F0 = 2026-07-01 → 2026-10-07 (JAMAIS vue par aucune campagne : le dernier
       chiffre publié s'arrête au 2026-07-01), F1 = full 2018-04 → 2026-10-07,
  F2 = OOS étendu 2024-01 → 2026-10-07, + duo accum+vrx 50/50 (mix.ts).
Lecture : F0 est un vrai OOS de 3 mois (rallye 64 k → 80 k+) — on le LIT, on
ne touche à rien. Zéro degré de liberté → aucune correction de multiplicité.

### 1.2 Hypothèses d'amélioration (chacune : barre, null, OOS une passe)
Barre commune (ROADMAP « cible à battre ») : dans SA dénomination, CAGR
supérieur à DD égal ou moindre sur IS **et** OOS 2024→2026-10, WF ancré ;
ou contribution portefeuille (ρ faible, recouvrement mesuré).
  A1 — **H14 vol-target / allocation dynamique du duo accum+vrx** (vierge).
       Grille FIGÉE : cible vol annualisée {30, 40, 50 %} × fenêtre d'estimation
       {20, 40, 60 j} × levier max 1 (spot, pas de levier : on ne peut que
       SOUS-exposer) ; variante régime : poids accum/vrx {50/50, 70/30, 30/70}
       conditionnés au gate EMA200-1d (bull → vrx seul ; hors-bull → 50/50).
       Null : vol-target sur equity PERMUTÉE par blocs 30 j (même distribution,
       séquence détruite) ; barre : Calmar duo > Calmar duo 50/50 fixe sur IS
       ET OOS, percentile ≥ 95 du null, coûts de rebalancement inclus (0,15 %
       par bascule virtuelle). Prior : moyen (un vol-target sur un moteur
       d'excursion peut dé-levier au mauvais moment — accum2 cooldown nuisait).
  A2 — **Fenêtre vierge comme juge de robustesse** : si F0 contredit
       fortement (perte > DD historique) une stratégie, diagnostic AVANT toute
       idée (données ? régime ? bug ?), consigné ici.
  A3 — **H5 lead-lag BTC→ETH / spot→perp au grain 4h** (vierge, prior faible
       après frais) : IC du retour BTC 4h sur ETH 4h suivant, et perp-basis
       BTC sur spot suivant ; test de séparation seulement (event study), pas
       de backtest tant que |IC| médian < 0,05 ou spread < 2× coûts.
Ordre : 1.1 → A1 → A2 (si déclenché) → A3. Ledger de TOUT essai ci-dessous.
Trop-beau : tout résultat > attendu = audit avant annonce.

## 2. Ledger

### 1.1 ✓ Fenêtre vierge + fenêtres étendues (2026-10-07, fresh.ts / duo.ts / f0_trades.ts)

| Stratégie | F0 VIERGE 07→10/2026 | OOS 2024→2026-10 | Full 2018→2026-10 |
|---|---|---|---|
| btc-accumulator | **−4,2 %** (DD −4,2, 2 tr, 0 gagnant) | **−3,4 %** (DD −25,3, 21 tr) — était +5,1 au 01/07 | +107,6 % (DD −32,7, 68 tr) — était +125,9 |
| btc-vrx | **−7,7 %** (DD −9,4, 1 tr) | **+7,9 %** (DD −19,7, 20 tr) — était +16,9 | +270,7 % (DD −35,9, 101 tr) — était +301,7 |
| eth-accumulator | 0,0 % (0 trade : dort en bull, correct) | +14,4 % (inchangé) | +514,8 % (DD −35,9, 52 tr) |
| duo accum+vrx 50/50 | −5,9 % (DD −6,8) | +2,2 % (DD −18,3) | +189,1 % (DD −31,5) — IS +179,3 / DD −19,6 inchangé |

Lecture : F0 = rallye 64 k → 80 k+ (BTC +25 %), le régime structurellement le
PIRE pour des moteurs vente-rachat (recovery en grind, cf. accum2) ; pertes
contenues (DD ≤ −9,4 %), 0 anomalie, 0 halte. **Fait n°1 pour Mario : depuis
2024-01 (33 mois sans bear soutenu) le benchmark base-denom « détenir » (0 %)
bat accum (−3,4 %) et le duo (+2,2 %) ; seule vrx reste au-dessus (+7,9 %).**
Les stratégies sont des moteurs de BEAR ; leur valeur se réalise dans les
cycles 2018/2022, et leur coût en bull-grind est réel (≈ −3 à −8 %/an).

**Parité moteur ↔ bots RÉELS sur F0 (A2, validation gratuite)** : trade accum
backtest vente 2026-07-24 19 h @ 64 062 → rachat 26/07 @ 64 800 (−1,34 %) =
le cycle LIVE exact (vente 64 047 le 24/07 16:00 UTC, rachat 64 768 le 26/07,
mêmes prix de référence 64 094/64 768 dans les deux journaux). Trade vrx
backtest vente 21/08 03 h @ 72 991 → rachat 31/08 @ 78 938 (−7,7 %) = le
signal que le bot live a RATÉ (gelé par la garde de sur-revendication le 21/08
00:00 après le retrait de 0,018 ₿ par Mario, recréé 12 h plus tard → sa vente
réelle à 77 222, cycle −2,4 %) : écart expliqué par l'incident, pas par le
moteur. Trade accum 13-14/07 (stop −2,8 %) antérieur à la recréation du bot
(19/07). ⇒ A2 non déclenchée (aucune contradiction forte), parité confirmée.

### A1 ⛔ H14 vol-target / allocation dynamique du duo (a1_voltarget.ts, 2026-10-07)

Duo fixe 50/50 : IS CAGR +19,6 %/DD −19,4 %/Calmar 1,01 ; OOS +0,8 %/−18,1 %/0,04.
**Vol-target (9 cellules figées, coût 0,15 %/bascule) : IS — Calmar DÉGRADÉ ou
égal partout (Δ −0,17…+0,01), percentile null 0-28 (pire ou égal au hasard de
séquence) ; OOS — Δ +0,01…+0,20, pct null 98-100.** Incohérence IS/OOS =
pas un edge : sur une fenêtre à +0,8 %/an, toute réduction d'exposition pendant
les pertes « aide » mécaniquement. Barre pré-enregistrée (Calmar > fixe sur IS
ET OOS) : ÉCHEC sur IS → ⛔, OOS non consommé pour la décision. Conforme au
prior (accum2 : rien à l'entrée ne prédit le tirage ; dé-levier tardif).
**Régime (bull EMA200-1d → vrx seul, sinon 50/50)** : IS Δ +0,04 (bruit),
OOS Δ −0,08 (jours bull 60 %) → ⛔. H14 « vol-target global » : réfuté pour
le duo. Ledger : 10 essais, 0 survivant.

### A3 ⛔ H5 lead-lag au grain 4h (a3_leadlag.ts, 2026-10-07, IS 2020→2024, 8 764 barres)

| Test | IC | IC médian/an | spread Q5−Q1 | barre 2×coûts |
|---|---|---|---|---|
| BTC→ETH (r_BTC[t]→r_ETH[t+1]) | −0,063 | −0,057 | −0,17 % | 0,60 % ⛔ |
| ETH→BTC | −0,067 | −0,067 | −0,02 % | ⛔ |
| BTC auto 4h | −0,073 | −0,069 | −0,07 % | ⛔ |
| basis perp/spot → r_spot[t+1] | −0,000 | −0,014 | −0,09 % | ⛔ |
| r_perp − r_spot → r_spot[t+1] | −0,018 | −0,016 | −0,08 % | ⛔ |

Pas de lead-lag directionnel : le seul signal = micro-RÉVERSION 4h (IC ≈ −0,06,
cohérente BTC/ETH/auto) dont le spread est **4-30× sous 2× les coûts taker**.
Même verdict que H11/accum4 (« réel, broyé par les coûts »). ⛔ H5 au grain 4h ;
OOS jamais regardé. **Angle MAKER noté une 5e fois** (H3, H8, H11, carry, H5).

## 3. Synthèse revalid1 (2026-10-07)

- Non-régression : baselines 8/8 ; parité moteur ↔ bots live EXACTE sur les
  cycles réels de l'été (24-26/07) — le moteur et les données sont sains.
- Fenêtre vierge 07→10/2026 (rallye +25 %) : accum −4,2 %, vrx −7,7 %, eth 0 tr,
  duo −5,9 % — coût normal d'un moteur de bear en bull-grind, DD ≤ −9 %.
- **Depuis 2024-01 (33 mois) : hold (0 %) > duo (+2,2 %) > accum (−3,4 %) ; vrx
  +7,9 %.** Les 3 stratégies ne « rapportent » que dans les bears (2018, 2022).
- Améliorations pré-enregistrées : A1 vol-target/régime ⛔ (IS dégradé), A3
  lead-lag ⛔ (sous coûts). Les défauts produit restent l'optimum local
  (confirme accum2/accum3 sur 3 mois de données neuves).
- Carte (ROADMAP 14 horizons + extension + revalid1) : épuisée AUX COÛTS TAKER.
  Gisement restant identifié, jamais ouvert : **exécution MAKER** (0,02 % OKX vs
  0,15 %/côté taker) — ré-juge mécaniquement les familles « réelles sous les
  coûts » (réversion 1j accum3, REV cross-section H1, micro-réversion 4h ici,
  saisonnalités H3) ; exige un modèle de fill passif (ratio, non-exécution) =
  chantier recherche + produit. Et regime1 = seul survivant chaîne complète,
  ρ≈0 avec le bloc bêta (contribution composite OOS Sharpe 0,66→1,30).
