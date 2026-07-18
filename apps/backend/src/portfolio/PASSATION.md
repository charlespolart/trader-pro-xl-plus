# PASSATION — PortfolioRunner : marche à blanc & Phase C

**Écrit le 2026-07-17 par la session Fable 5 qui a construit tout ceci, à
destination du modèle qui prendra la suite (Opus 4.8) dans ~2 semaines,
pour la revue de marche à blanc puis la Phase C. Mario (l'utilisateur,
trader-dev expérimenté, français) a explicitement demandé cette passation
pour « être sûr que le successeur ne fasse pas de merde ». Lis ce document
EN ENTIER avant d'agir. En cas de doute : demander à Mario, ne JAMAIS
improviser sur ce système.**

---

## 0. Règles INVIOLABLES (par ordre de priorité)

1. **Tout GO de Mario est EXPLICITE, nominatif et récent.** « continue »
   autorise la poursuite du travail en cours, JAMAIS : un déploiement, de
   l'argent réel, un mouvement de fonds, une clé API de trading, une
   modification des bots live.
2. **Les 3 bots live (accum, vrx, eth-accum) sont intouchables** : ne pas
   modifier leur code chargé, leur image Docker (`ghcr.io/...backend`),
   `ops/docker-compose*.yml`, `/srv/tpx/.env`, ni redémarrer leurs
   conteneurs (`tpx-backend-1`, `tpx-postgres-1`, `tpx-caddy-1`).
3. **Aucun déploiement de l'image backend sur le VPS sans GO** (règle Mario
   2026-07-17). Le PortfolioRunner est un système SÉPARÉ précisément pour ça.
4. **Le mode LIVE (envoi d'ordres) N'EXISTE PAS dans le code.** C'est
   volontaire. Ne l'écrire qu'en Phase C, après le GO post-revue, selon la
   spec §6 — et rien d'autre.
5. **Aucun mouvement de fonds, jamais, sans permission explicite** (même un
   virement interne — règle héritée de l'incident 2026-07-14).
6. La barre de validation de la recherche ne se renégocie pas ; les chiffres
   de référence sont dans `research/regime1/LOG.md` et
   `research/listing2/LOG.md`. **Ne JAMAIS citer les CAGR composés de
   listing2 (+582 % etc.) : artefact de composition documenté** — les bons
   chiffres : Sharpe, méd/trade, DD.
7. Kill switch d'urgence : `touch /srv/tpx-portfolio/portfolio.KILL` (VPS)
   ou `portfolio.KILL` à la racine du repo (local). Toujours disponible.

## 1. Contexte en bref

Deux stratégies validées par une chaîne complète (protocoles pré-enregistrés,
placebos, OOS une passe, réplication perps réels, exécutabilité OKX,
robustesse venue Bybit) :
- **regime1** : sleeve dormante ; si la médiane du funding des perps
  éligibles ≥ 2,5 bps/j → short quintile funding-max + long BTC 1:1, K=7 j.
- **listing2** : short des nouveaux listings **Binance** (pas OKX-only,
  testé sans drift) ayant un perp ≤ J+7 ; S2 K30, stop close +50 %,
  10 slots, **marge isolée par position obligatoire** (8 % des événements
  dépassent +100 % adverse).
Fiches complètes : `docs/regime1.html`, `docs/listing2.html`,
`research/regime1/PROPOSITION.md`. Étude d'architecture :
`research/moteur-multi/ETUDE.md`.

## 2. Cartographie du code (`apps/backend/src/portfolio/`)

| Fichier | Rôle | Ce qu'il ne faut pas casser |
|---|---|---|
| `targets.ts` | cibles du jour des 2 stratégies | PARITÉ BIT-IDENTIQUE avec `research/portfolio-bt/` (check_targets : 313/313). Toute modification ⇒ relancer `check_targets.ts` ET `run.ts` |
| `dataFeed.ts` | données quotidiennes runtime | la source funding runtime = table `funding_rates` agrégée ; les jours récents viennent de Coinalyze en PSEUDO-ÉVÉNEMENTS à **12:30:00 UTC** (§7.1) |
| `okxPortfolioAdapter.ts` | plan d'ordres pur + exécution | DRY par défaut ; `arm('LIVE')` lève une erreur exprès |
| `portfolioRunner.ts` | le tick quotidien | gardes (fraîcheur 36 h, kill, plafond brut 2,2×), état v2 par stratégie, idempotent par jour |
| `tick.ts` / `refresh.ts` / `bootstrap.ts` | CLI | `tick.ts table` = le vrai chemin runtime ; `csv` = parité recherche |
| `check_targets.ts` / `backfill_check.ts` | contrôles | à relancer après TOUT changement de data/targets |
| `research/portfolio-bt/` | backtests TS (vérité) | parité python documentée dans `run.ts` (tolérances expliquées) |

## 3. Installation VPS (état au 2026-07-17)

- Hôte : `root@45.32.123.66` (clé `~/.ssh/tpx_deploy` sur le Mac de Mario),
  hostname `pro-xl-plus`. **RAM 954 Mi (!), swap 2,4 G, disque ~15 G libres.**
- `/srv/tpx-portfolio/repo` = copie rsync du repo (SANS node_modules
  locaux : installés par le conteneur ; SANS les CSV de recherche).
- `/srv/tpx-portfolio/.env` = 7 variables (DATABASE_URL/RESEARCH_DB →
  `postgres:5432` réseau docker interne, TELEGRAM_*, COINALYZE_API_KEY,
  PORTFOLIO_STATE_DIR, PORTFOLIO_KILL_PATH). **Construit par indirection
  depuis /srv/tpx/.env — ne JAMAIS afficher son contenu dans un transcript.**
- Exécution : **conteneur éphémère** `oven/bun:1` attaché au réseau
  `tpx_default`, `--memory 500m --memory-swap 900m` (si OOM c'est le tick
  qui meurt, jamais Postgres). AUCUN service permanent ajouté.
- `nightly-vps.sh` = wrapper cron (voir son en-tête pour la ligne crontab).
- Bootstrap des données : `bootstrap.ts` (candles 1d univers dès 2025-01 +
  funding dès 2026-04, univers via `universe.txt`). La base prod n'avait
  QUE les paires des bots — l'univers ne peut pas s'en déduire seul.
- Écritures en base prod : ~2 500 lignes/jour (candles+funding) — anodin,
  validé par Mario. Ne RIEN écrire d'autre dans cette base.
- Mise à jour du code sur le VPS : re-rsync depuis le Mac avec les MÊMES
  exclusions **ancrées** (`--exclude '/data/'`, pas `data/` — §7.6).

## 4. Surveiller la marche à blanc (ton travail des 2 semaines)

Chaque jour (ou tous les 2-3 jours) : lire `/srv/tpx-portfolio/nightly.log`
et l'état `/srv/tpx-portfolio/state/.paper-state.json`.

**NORMAL** : porte OFF des jours/semaines durant (marché calme = sleeve
dormante — au 2026-07-17 la porte est à 1,50 bps/j, OFF) ; « abstention —
données périmées » un jour isolé (rattrapé le lendemain) ; skips
« instrument OKX indisponible » (couverture 26-55 % documentée) ; 0 slot
listing2 pendant des jours (le flux réel ≈ 1-2 listings/semaine).

**ANORMAL → investiguer, et pinger Mario si matériel** : exceptions/stack
traces ; plafond brut déclenché ; équité paper qui saute sans position ;
funding frais en échec plusieurs jours de suite (quota Coinalyze ?) ;
`lastTickDay` qui ne progresse plus alors que le cron tourne.

**Hygiène mensuelle** : relancer `backfill_check.ts` (localement, base
recherche) après l'archivage Vision du mois → la parité doit rester à
0 divergence ; relancer les syncs Coinalyze de la recherche
(`accum6/sync_coinalyze.py`, fenêtres glissantes).

## 5. Critères de fin de marche à blanc (revue avec Mario)

1. ≥ 14 ticks exécutés (trous rattrapés admis), ≥ 2 rebalancements K7.
2. **Cohérence runner↔backtest** : rejouer `portfolio-bt/run.ts` sur la
   fenêtre de marche à blanc et comparer jour par jour aux décisions du
   state (mêmes portes, mêmes sélections aux rebals, pnl paper ≈ backtest
   à la tolérance du slippage provisionné).
3. Parité funding toujours 0 divergence au re-check mensuel.
4. Si des listings sont survenus : chaque événement tracé proprement
   (détection → slot → sortie K30/stop).
5. Aucun incident de garde non expliqué.
→ Présenter le bilan à Mario. C'est LUI qui décide du passage en Phase C.

## 6. Spécification Phase C (le mode LIVE) — à n'écrire QU'APRÈS le GO

Principes : le moins de code neuf possible, réutiliser la plomberie OKX
éprouvée du repo, et TOUT ce qui suit :

1. **Compte** : sous-compte OKX DÉDIÉ créé par Mario. D'abord clés LECTURE
   SEULE (reconcile réel pendant quelques jours), puis clés trade au GO.
   Jamais les clés du compte principal.
2. **Envoi d'ordres** : étendre `OkxPortfolioAdapter.execute` (le point
   prévu). Réutiliser `packages/data/src/okx/orders.ts` (`buildOrderBody` —
   market, `tdMode` **isolated**) et la couche REST privée signée
   existante (voir `okxLiveAdapter.ts` / `okx/rest` pour le client signé —
   NE PAS réécrire une signature HMAC à la main).
3. Avant le premier ordre d'un instId : `setLeverage(instId, 1, 'isolated')`
   (`okx/account.ts`).
4. **clOrdId préfixés** par stratégie+date (`r1YYMMDD…`, `l2YYMMDD…`) —
   convention maison pour l'attribution (cf. OkxUserStreamRouter).
5. **Pré-trade par batch** : re-lire positions réelles
   (`account.allPositions('SWAP')`) et balances ; si dérive vs l'état
   attendu > tolérance → GEL de la stratégie + Telegram + attendre Mario
   (pattern de l'incident 2026-07-14 : ne JAMAIS trader sur un livre
   fantôme).
6. **Post-trade** : reconcile (les positions réelles remplacent l'état
   paper), journaliser chaque fill (l'équivalent des tables orders/fills).
7. **Funding réel** : ingérer les bills OKX (`/account/bills`, type
   funding) quotidiennement — en perps, le funding EST une part du P&L ;
   sans ça l'équité dérive en silence.
8. **Limites dures** : tailles minimales d'abord (~30 USDT/jambe,
   sous-compte ~100-500 USDT) pendant ≥ 2 cycles/2 semaines ; montée en
   sleeve UNIQUEMENT après revue et GO ; plafond brut inchangé ; pas de
   retry créatif (un ordre rejeté = skip + log + Telegram, pas de boucle).
9. **Interdits** : pas de martingale, pas d'« amélioration » de stratégie en
   passant (tout changement de règle = retour à la case recherche avec
   protocole), pas de cross-margin, pas de trading hors sous-compte.

## 6bis. Amendements Phase C décidés avec Mario (2026-07-18)

Discussion Mario ↔ Fable 5 pendant la marche à blanc — ces décisions COMPLÈTENT
la spec §6 (elles ne remplacent rien d'autre) :

1. **Un sous-compte PAR stratégie** (amende le « sous-compte dédié » unique du
   §6.1) : une sleeve = un sous-compte = un budget de capital physiquement
   plafonné, P&L lisible directement (équité du sous-compte = perf de la
   stratégie), aucun bug de sizing d'une sleeve ne peut consommer les USDT de
   l'autre. Fait : Mario a créé le premier (`tpxportfolio`, type Standard,
   dépôts OFF — vase clos : alimentation par virement interne uniquement,
   retraits impossibles par nature) et sa clé API (rangée chez lui ; OKX purge
   les clés inactives → la recréer au besoin le jour J, 2 min). Nom de
   sous-compte : 6-20 caractères, lettres+chiffres, pas de spéciaux.
2. **Migration des 3 bots spot vers un sous-compte chacun** : fait
   disparaître STRUCTURELLEMENT le risque « bots qui se marchent dessus »
   (l'arithmétique de sur-revendication née de l'incident 2026-07-14 devient
   sans objet). Virements des parts = go explicite Mario, comme toujours.
   Ne PAS toucher aux bots qui tournent avant ce moment.
   **⚡ AVANCÉ (décision Mario 2026-07-18) : la FONCTIONNALITÉ multi-comptes
   se code MAINTENANT, sans attendre la revue** (utile quel que soit le
   verdict des 2 semaines) : comptes/clés API illimités avec LABEL, choix du
   compte au lancement d'une stratégie, affichage par compte du label et de
   l'ÉQUITÉ. Spec de reprise détaillée : mémoire
   `next_multicomptes_2026-07-18` (pointeurs techniques : credentialName par
   bot, routeur WS par COMPTE et non par mode, siblingBaseClaims scopé par
   credential, page compte multi-credentials). La MIGRATION des fonds, elle,
   reste au go explicite.
   **✅ CODÉ (2026-07-18, même jour) — livré sur master, PAS déployé sur le
   VPS** (les 3 bots live tournent sur l'image précédente, intouchés) :
   - DB : `api_credentials.demo` (bool, migration 0004 pose testnet→true) +
     `bots.credential_name` (NULL = compat 'live'/'testnet' selon le mode) ;
   - `effectiveCredentialName(mode, credentialName)` dans @tpx/shared = LA
     clé de scoping (routeur WS privé par COMPTE, siblingBaseClaims par
     compte, garde anti-doublon futures par compte, refus de suppression
     d'un compte utilisé par un bot) ;
   - gardes de sécurité : bot LIVE sur clé démo REFUSÉ, bot démo sur clé
     réelle REFUSÉ (création, édition ET démarrage) ;
   - API : `GET /credentials` (liste + équité par compte, `null` si clés
     illisibles ≠ 0 $ d'un sous-compte vide), `/account?name=…`,
     PUT/DELETE credentials généralisés ;
   - UI : Réglages = carte « Comptes OKX » (CRUD, label, badge démo/réel,
     équité, date des clés) ; création de bot = sélecteur « Compte
     d'exécution » (label + équité, filtré par type de clé) ; liste des
     bots = colonne Compte ; WalletCard cycle sur tous les comptes ;
   - validé : typecheck 7/7, 174 tests verts, build web, smoke e2e local
     (création compte → bot dessus → refus délétion/refus démo↔réel).
   Prochaine étape (Mario) : créer les 3 sous-comptes + leurs clés API,
   les saisir dans Réglages, puis recréer les 3 bots chacun sur son
   sous-compte — la migration des FONDS reste un go explicite séparé,
   et le déploiement VPS de cette version aussi.
3. **UI unifiée « Stratégies » — un seul onglet, DEUX moteurs** (demande
   explicite de Mario : tout voir/piloter au même endroit) :
   - une seule liste : 3 bots spot + 2 sleeves, même langage visuel partout
     (statut, équité, P&L, pause, colonne sous-compte) ;
   - le détail s'adapte au type : bot → page classique (chandeliers, ordres,
     logs) ; sleeve → page panier (jambes, état de la PORTE avec la valeur du
     critère en clair, historique des ticks nocturnes, funding encaissé,
     courbe d'équité du sous-compte) ;
   - activer une sleeve = un formulaire façon « créer un bot » (choisir
     clé/sous-compte, taille de sleeve, confirmation) — même geste, sans
     prétendre que c'est le même moteur ;
   - **INTERDIT de fusionner les moteurs** : une sleeve tient un PANIER
     multi-instruments sélectionné par classement d'univers — le moteur
     defineStrategy est mono-symbole par construction. Le faire rentrer au
     chausse-pied = des semaines de chirurgie du moteur validé + re-validation
     complète = exactement l'improvisation que ce document interdit. L'unité
     est VISUELLE, pas mécanique.
   - toujours pas de bouton « forcer un trade » ni d'édition des règles de
     stratégie dans l'UI (changement de règle = retour recherche, §6.9).
4. **Timing** : coder l'UI + le multi-clés PENDANT la phase lecture seule du
   sous-compte (l'onglet s'alimente en vraies données sans pouvoir de
   nuisance) ; Telegram reste le pouls en parallèle (l'UI contrôle, Telegram
   notifie). Rappel séquence : revue marche à blanc → GO 1 (clé lecture
   seule + code exécution + UI) → GO 2 (clé trade, tailles minuscules
   ≥ 2 semaines) → revue → montée en taille éventuelle.

## 7. Le bêtisier (pièges VÉCUS — chacun a coûté une itération)

1. **Jitter de millisecondes des fundingTime Binance** : les événements
   réels tombent à `12:00:00.001`, `00:00:00.010`… → ne JAMAIS identifier
   quoi que ce soit par timestamp exact. Les pseudo-événements Coinalyze
   sont à **12:30:00 UTC pile** (heure physiquement impossible pour un
   règlement) — c'est la 3e itération de cette signature, ne pas y toucher.
2. **Perps à funding 4 h** (DIA, NIL, SOLV, ME, CTK…) : 6 événements/jour,
   pas 3. Toute hypothèse « 3 événements par jour » est fausse pour ~40 %
   des perps récents.
3. **Coinalyze** : unités en POURCENT (0.01 = 1 bps → ÷100) ; un symbole
   invalide fait rejeter TOUT son batch (filtrer par `future-markets`
   d'abord) ; les 429 se traitent avec un backoff ~25 s (l'API compte
   ~par symbole, pas par requête) ; l'historique OKX/funding direct est
   limité (~3 mois) et l'API Bybit est GÉO-BLOQUÉE (France).
4. **fapi.binance.com est géo-bloqué** (données futures REST) : ne jamais
   compter dessus ; Vision (archive) + Coinalyze (frais) est LE duo.
5. **Le funding des ~15 derniers jours n'existe pas sur Vision** (archivage
   mensuel) — d'où les pseudo-événements. La purge `reconcileFunding` les
   remplace quand Vision rattrape.
6. **rsync `--exclude data/` non ancré a exclu `packages/data`** → toujours
   ancrer : `--exclude '/data/'`.
7. **RAM VPS = 954 Mi** : tout `docker run` de travail passe avec
   `--memory 500m` — sans cap, l'OOM killer peut viser Postgres (les bots !).
8. **cwd volatil entre commandes de session** : toujours `cd` absolu.
9. Le CSV `funding_daily_all.csv` = source RECHERCHE (gitignoré,
   régénérable) ; le runtime utilise la TABLE. La parité des deux est
   vérifiée (10 405 jours, 0 divergence) — la re-vérifier après tout
   changement de pipeline.
10. Les scripts de recherche `research/**` sont des PIÈCES DE VALIDATION :
    ne pas les « nettoyer », « moderniser » ni corriger leurs erreurs de
    typecheck cosmétiques — ils re-produisent les chiffres publiés.

## 8. État exact à la passation (2026-07-17)

- Marche à blanc : cron VPS à installer/valider (voir §3 et l'en-tête de
  `nightly-vps.sh`) ; bootstrap des données lancé le 17-07 au soir.
- Parité funding : ✓ 0 divergence (10 405 jours).
- Porte regime1 du jour : 1,50 bps/j → OFF (marché en Extreme Fear).
- Les fiches et l'étude moteur sont dans `docs/` et `research/`.
- La mémoire persistante (`~/.claude/.../memory/`) contient le handoff
  actif et les règles — la relire en début de session.
- Ce qui attend Mario : la revue de marche à blanc (dans ~2 semaines), le
  sous-compte OKX, puis les GO successifs.

**Rappel final : ce système touche à terme de l'argent réel. La lenteur
méthodique est une feature. Chaque ambiguïté se résout par une question à
Mario, pas par une initiative.**
