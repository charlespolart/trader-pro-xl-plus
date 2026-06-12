# Trader Pro XL+

Plateforme de trading algorithmique crypto (Binance **Spot** + **Futures USDT-M**) : bots live, paper trading, backtesting haute fidélité, optimisation de stratégies, UI web temps réel.

## Stack

- **Bun + TypeScript** partout (monorepo workspaces, scope `@tpx`)
- **Backend** : Hono + WebSocket — **Front** : React 19 + Vite + Tailwind 4 + Lightweight Charts v5
- **DB** : PostgreSQL (Drizzle ORM) — aggTrades en fichiers binaires colonnes compressés sur disque
- **Stratégies** : fichiers TypeScript natifs dans `strategies/`, même code en backtest et en live

## Démarrage rapide

```bash
cp .env.example .env        # puis remplir MASTER_KEY (voir .env.example)
bun install
bun run db:up               # Postgres via Docker
bun run db:migrate
bun run dev:server          # API sur :3001
bun run dev:web             # UI sur :5173
```

## Structure

| Dossier | Rôle |
|---|---|
| `packages/shared` | Types du domaine (front + back) |
| `packages/core` | Indicateurs, API de stratégie, moteur de backtest, optimiseur |
| `packages/db` | Schéma Drizzle + migrations |
| `packages/data` | Clients Binance (REST/WS), téléchargement historique (Binance Vision), stockage |
| `apps/server` | API, gestionnaire de bots, runner de backtests (workers) |
| `apps/web` | UI React |
| `strategies/` | Vos stratégies (TypeScript) |

Documentation complète de l'API de stratégie : `docs/strategies.md` (à venir avec les exemples).
