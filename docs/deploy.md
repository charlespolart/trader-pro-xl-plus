# Déploiement VPS

Exécution sur OKX, données sur Binance. Le **backend** (API + WS + bots) est
conteneurisé et déployé via CI ; le **front** (build Vite) est déployé
séparément (rsync), pour qu'une modif front ne redémarre **jamais** le back.

## Architecture (prod)

```
Navigateur ─HTTPS─▶ Caddy ┬─ /api,/ws ─▶ backend (conteneur, API+WS) ─▶ Postgres (conteneur)
   (443, TLS auto)        └─ /*        ─▶ /srv/tpx/web (build front statique)
```

- **Caddy** : reverse-proxy `/api`+`/ws` → backend, sert le SPA pour le reste, TLS automatique (ACME).
- **Backend** : image GHCR, ne sert pas le front en prod (Caddy s'en charge).
- **Postgres** : `postgres:17-alpine`, données sur bind-mount `/srv/tpx/postgres`.
- Fichiers infra : `ops/docker-compose.{yml,dev.yml,prod.yml}`, `ops/Caddyfile`.

| Déploiement | Commande | Impact backend |
|---|---|---|
| Backend | `make deploy` (CI → GHCR → VPS, migre la DB, restart back) | restart (réconcilie la position OKX au boot) |
| Front | `make deploy-web` (build + rsync vers `/srv/tpx/web`) | **aucun** (Caddy sert les nouveaux fichiers) |
| Rollback back | `make deploy TAG=<sha7>` (image GHCR antérieure) | restart |

---

## 0. Prérequis (⚠️ à valider AVANT de louer le VPS)

1. **Région du VPS** : le bot lit les **flux Binance en live**. Vérifier depuis l'IP du VPS que Binance public est joignable (pas de 451) :
   ```bash
   curl -sI https://data-api.binance.vision/api/v3/time | head -1   # 200 attendu
   curl -sI https://fapi.binance.com/fapi/v1/time     | head -1     # 200 attendu (flux futures)
   ```
   Et que **OKX autorise le trading** depuis cette région. Si Binance répond 451 → changer de région.
2. **Domaine** : un enregistrement DNS **A** (et AAAA si IPv6) pointant sur l'IP du VPS (ex. `trader.tondomaine.com`).
3. **Clé API OKX** (à créer plus tard dans l'UI, mais prévoir) : permissions **Trade + Read** (PAS Withdraw), **IP allowlist = IP du VPS**, + passphrase. Compte en mode **net/one-way + isolated**.

## 1. Repo GitHub (une fois)

```bash
gh repo create trader-pro-xl-plus --private --source=. --remote=origin --push
# secrets pour la CI de déploiement :
gh secret set VPS_HOST   --body '<ip-du-vps>'
gh secret set VPS_USER   --body 'root'
gh secret set VPS_SSH_KEY < ~/.ssh/<clé-privée-de-déploiement>   # le '<' est crucial
```
(GHCR utilise `secrets.GITHUB_TOKEN` automatiquement — rien à configurer.)

## 2. Provisioning du VPS (une fois, en root)

```bash
# Docker
curl -fsSL https://get.docker.com | sh

# Arborescence persistante
mkdir -p /srv/tpx/{ops,web,data,postgres,caddy/data,caddy/config}
chown -R 999:999 /srv/tpx/postgres        # uid postgres dans l'image alpine

# Login GHCR pour pull l'image privée :
#   créer un PAT GitHub CLASSIQUE (pas fine-grained), scope SEULEMENT read:packages
echo '<PAT-classic>' | docker login ghcr.io -u <ton-user-github> --password-stdin

# Secrets de prod (root, 0600) — copier ops/.env.prod.example et remplir
#   (génère MASTER_KEY: bun -e "console.log(crypto.randomBytes(32).toString('hex'))")
install -m 600 /dev/stdin /srv/tpx/.env <<'EOF'
GHCR_OWNER=<ton-user-github-en-minuscules>
DOMAIN=trader.tondomaine.com
ACME_EMAIL=toi@exemple.com
POSTGRES_USER=tpx
POSTGRES_PASSWORD=<mot-de-passe-fort>
POSTGRES_DB=tpx
ADMIN_PASSWORD=<mot-de-passe-UI-fort>
MASTER_KEY=<64-hex-générés-et-SAUVEGARDÉS>
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
EOF
```
> **Sauvegarde `MASTER_KEY` ailleurs** : la perdre = clés OKX stockées indéchiffrables.

## 3. Premier déploiement

```bash
# Backend : build l'image en CI, push GHCR, SSH, migre la DB (crée les tables), démarre back+caddy
make deploy

# Front : build le SPA et le rsync vers /srv/tpx/web (Caddy le sert)
make deploy-web
```
À la fin, `https://trader.tondomaine.com` doit afficher l'UI (login si `ADMIN_PASSWORD` est défini). Caddy obtient le certificat TLS automatiquement au premier accès.

## 4. Mise en service (gate avant argent réel)

1. Dans **Settings**, saisir les clés OKX **Démo** (`x-simulated-trading`), faire un **smoke** :
   placer/annuler un ordre, vérifier l'attribution du fill, déclencher un stop, tester une jambe OCO.
2. Vérifier que le compte OKX est en **net/one-way + isolated**.
3. Puis saisir les clés **LIVE** (IP allowlist = VPS) et démarrer un bot avec une petite allocation.

## Au quotidien

| Besoin | Commande |
|---|---|
| Déployer une modif **backend** | `make deploy` |
| Déployer une modif **front** | `make deploy-web` |
| **Rollback** backend | `make deploy TAG=<sha7>` (l'image doit exister sur GHCR) |
| Logs backend | `ssh root@vps 'cd /srv/tpx && docker compose -f ops/docker-compose.yml -f ops/docker-compose.prod.yml logs -f backend'` |
| État | `… docker compose … ps` |

## Note dev local (une fois)

Le compose a été refactoré (`name: tpx`). L'ancien conteneur Postgres local
s'appelait `tpx-postgres` et tournait sur le même port — le supprimer une fois,
puis `make db` repart sur **le même volume** (`trader-pro-xl-plus_pgdata`, cache
de bougies préservé) :
```bash
docker rm -f tpx-postgres
make db        # base + overlay dev, port 5436
make back      # backend natif
```

## Migrations DB

Drizzle, **forward-only**. Chaque `make deploy` lance
`drizzle-kit migrate` dans le conteneur (3 tentatives) avant de redémarrer le
back. Un rollback de schéma irréversible nécessiterait une restauration DB.
