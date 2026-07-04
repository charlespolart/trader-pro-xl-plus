# Déploiement VPS

Exécution sur OKX, données sur Binance. Le **backend** (API + WS + bots) est
conteneurisé et déployé via CI ; le **front** (build Vite) est déployé
séparément (rsync), pour qu'une modif front ne redémarre **jamais** le back.

## Architecture (prod)

```
Navigateur ─HTTPS─▶ Caddy ┬─ /api,/ws ─▶ backend (conteneur, API+WS) ─▶ Postgres (conteneur)
   (443, TLS auto)        └─ /*        ─▶ /srv/tpx/web (build front statique)
```

- **Caddy** : reverse-proxy `/api`+`/ws` → backend, sert le SPA pour le reste, TLS automatique (ACME) **+ mTLS** : seul un appareil porteur du certificat client passe le handshake — pour le reste d'internet, l'app n'existe pas (voir § 2 bis).
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

# Secrets de prod (root, 0600) — partir de l'exemple et remplir CHAQUE champ
#   (génère MASTER_KEY: bun -e "console.log(crypto.randomBytes(32).toString('hex'))")
scp ops/.env.prod.example root@<ip-du-vps>:/srv/tpx/.env
ssh root@<ip-du-vps> 'chmod 600 /srv/tpx/.env && vi /srv/tpx/.env'
```
> ⚠️ **Piège `$`** : compose ≥ 2.24 **interpole** les valeurs de ce fichier
> (`env_file` compris). Un `$` dans un mot de passe doit être écrit `$$`,
> sinon la valeur est silencieusement tronquée — le backend refuse alors de
> démarrer (garde-fou env, fail-closed).
> `IMAGE_TAG` est écrit par la CI (dernier deploy sain) — ne pas y toucher.
>
> **Sauvegarde `MASTER_KEY` ailleurs** : la perdre = clés OKX stockées indéchiffrables.

## 2 bis. mTLS — CA privée + certificats clients (une fois)

Caddy exige un **certificat client** (`client_auth require_and_verify`, CA
montée depuis `/srv/tpx/caddy/ca.crt`). À faire **avant** le premier
`make deploy` : sans `ca.crt`, le conteneur caddy ne démarre pas ; sans cert
client installé, aucun appareil ne peut ouvrir l'UI.

```bash
# Sur une machine de confiance (PAS le VPS — la clé de la CA n'a rien à y faire) :
openssl genrsa -out tpx-ca.key 4096
openssl req -x509 -new -key tpx-ca.key -sha256 -days 3650 -subj '/CN=TPX CA' -out tpx-ca.crt

# Un certificat PAR APPAREIL (ex. « macbook ») :
openssl genrsa -out macbook.key 2048
openssl req -new -key macbook.key -subj '/CN=macbook' -out macbook.csr
openssl x509 -req -in macbook.csr -CA tpx-ca.crt -CAkey tpx-ca.key -CAcreateserial -days 1825 -out macbook.crt
# Format importable (macOS/iOS/Android veulent un .p12 ; mot de passe d'export demandé à l'import) :
openssl pkcs12 -export -in macbook.crt -inkey macbook.key -out macbook.p12

# Publier la CA (partie PUBLIQUE) sur le VPS :
scp tpx-ca.crt root@<ip-du-vps>:/srv/tpx/caddy/ca.crt
```

- **Installer le `.p12`** : macOS → double-clic (Trousseau, session) ; iOS →
  AirDrop puis Réglages → Général → VPN et gestion de l'appareil ; le
  navigateur propose le certificat au premier accès au domaine.
- **Nouvel appareil** = signer un nouveau cert avec la CA et l'installer —
  aucun redéploiement, Caddy fait confiance à toute la CA.
- **`tpx-ca.key` hors ligne et sauvegardée** : la perdre = régénérer CA + tous
  les certs ; la fuiter = n'importe qui peut se forger un accès.

## 3. Premier déploiement

```bash
# Backend : build l'image en CI, push GHCR, SSH, migre la DB (crée les tables), démarre back+caddy
make deploy

# Front : build le SPA et le rsync vers /srv/tpx/web (Caddy le sert)
make deploy-web
```
À la fin, `https://trader.tondomaine.com` doit afficher l'UI **depuis un appareil porteur du certificat client** (§ 2 bis) — depuis tout autre appareil, l'erreur TLS est normale, c'est le mTLS qui refuse. Login avec `ADMIN_PASSWORD`. Caddy obtient le certificat TLS serveur automatiquement au premier accès.

## 4. Mise en service (gate avant argent réel)

1. Dans **Settings**, saisir les clés OKX **Démo** (`x-simulated-trading`) et démarrer le bot en mode démo.
2. Valider un **cycle complet** : vente au signal, **stop de protection ARMÉ** (visible dans les ordres ouverts OKX), rachat (recross ou stop), soldes cohérents après un restart du backend (réconciliation).
3. Vérifier que le compte OKX est en **net/one-way + isolated**.
4. Puis saisir les clés **LIVE** (IP allowlist = VPS) et démarrer avec une petite position initiale.

## Au quotidien

| Besoin | Commande |
|---|---|
| Déployer une modif **backend** | `make deploy` |
| Déployer une modif **front** | `make deploy-web` |
| **Rollback** backend | `make deploy TAG=<sha7>` — redéploie l'image EXISTANTE telle quelle (aucun rebuild, `:latest` non touché) ; échoue si le tag n'existe pas sur GHCR. En cas de deploy **malsain**, le pipeline revient tout seul au dernier tag sain (`IMAGE_TAG` mémorisé dans `/srv/tpx/.env` après chaque succès) |
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
