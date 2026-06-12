# Trader Pro XL+

Plateforme de trading algorithmique crypto **Binance Spot + Futures USDT-M** : bots live, paper trading, backtesting haute fidélité, optimisation de stratégies (grid + walk-forward), UI web temps réel. Conçue pour tourner sur un VPS (UI protégée par mot de passe), avec les backtests en local sur une grosse machine.

## Démarrage rapide

```bash
cp .env.example .env
# Renseignez MASTER_KEY :  bun -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
bun install
bun run db:up           # Postgres (Docker) — port configurable via POSTGRES_PORT
bun run db:migrate
bun run dev:server      # API + WS sur :3001
bun run dev:web         # UI dev sur :5173 (proxy vers :3001)
```

Production sur VPS : `bun run build` puis `bun run start` — le serveur sert l'UI compilée sur le port 3001. Mettez un `ADMIN_PASSWORD` dans `.env`.

## Fonctionnalités

- **Stratégies en TypeScript natif** (`strategies/*.ts`) — paramètres déclaratifs (formulaire UI auto-généré), indicateurs incrémentaux (mêmes valeurs en backtest et en live), multi-timeframes, multi-paires, accès aggTrades. → **[Guide complet](docs/strategies.md)**
- **Backtests haute fidélité** : fills sur bougies (chemin intra-bar configurable) ou sur **aggTrades rejoués** (fills partiels, déclenchements exacts), frais maker/taker + réduction BNB, slippage, funding historique, liquidations futures, warmup automatique, MAE/MFE et **raison de chaque entrée/sortie**.
- **Données locales d'abord** : bougies en Postgres avec suivi de couverture, aggTrades en fichiers binaires compressés ; téléchargement massif via les ZIP **Binance Vision**, l'API REST ne comble que les bouts récents. Re-backtester la même période ne retélécharge rien.
- **Optimiseur** : grid search parallélisé (workers) + **walk-forward** (in-sample/out-of-sample) avec verdict anti-overfitting.
- **Bots** : instances stratégie × paire × mode (`paper` / `testnet` / `live`), allocation virtuelle, levier, reprise après redémarrage (état persisté + réconciliation des ordres par préfixe de clientOrderId).
- **Risque** : par bot (position max, perte journalière, drawdown max, pertes consécutives, cooldown) + global (exposition totale, **kill switch** avec fermeture optionnelle des positions). Alertes Telegram.
- **UI temps réel** : dashboard, chart Lightweight Charts (indicateurs en panes, marqueurs de trades avec raisons, annotations de stratégie, **replay bougie par bougie** des backtests), équité/drawdown, éditeur de stratégies (Monaco) avec rechargement à chaud, gestionnaire de données.

## Structure

| Dossier | Rôle |
|---|---|
| `packages/shared` | Types du domaine (front + back) |
| `packages/core` | Indicateurs, API de stratégie, runtime, exchange simulé, moteur de backtest, métriques, optimiseur |
| `packages/db` | Schéma Drizzle + migrations Postgres |
| `packages/data` | Clients Binance (REST/WS, spot + futures + testnets), Binance Vision, stores de données |
| `apps/server` | API Hono + WS, gestionnaire de bots, moteurs live, runner de backtests (workers Bun) |
| `apps/web` | UI React 19 + Tailwind 4 + Lightweight Charts v5 |
| `strategies/` | Vos stratégies (3 exemples fournis) |

## Notes importantes

- **IP géo-bloquée par Binance (erreur 451)** : les données spot basculent automatiquement sur le miroir officiel `data-api.binance.vision`, le funding passe par les archives Vision — backtests et recherche fonctionnent. Le trading réel et les données futures récentes nécessitent une IP autorisée (votre VPS).
- **Clés API** : stockées chiffrées (AES-256-GCM avec `MASTER_KEY`). Créez des clés sans droit de retrait, avec whitelist IP.
- **Un bot futures par paire et par mode** (live/testnet) : Binance fusionne les positions d'un même symbole sur le compte.
- Tests du moteur : `bun test packages/core`.
