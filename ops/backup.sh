#!/usr/bin/env bash
# Dump HEBDOMADAIRE de la DB (historique trades/bots + clés OKX chiffrées) avec
# rotation 8 semaines. Installé en cron (lundi 04:10 UTC) par le déploiement.
# Restauration :
#   docker compose --env-file /srv/tpx/.env -f ops/docker-compose.yml -f ops/docker-compose.prod.yml \
#     exec -T postgres sh -c 'pg_restore -U "${POSTGRES_USER:-tpx}" -d "${POSTGRES_DB:-tpx}" --clean --if-exists' \
#     < /srv/tpx/backups/tpx-<stamp>.dump
set -euo pipefail
cd /srv/tpx
mkdir -p backups

COMPOSE="docker compose --env-file /srv/tpx/.env -f ops/docker-compose.yml -f ops/docker-compose.prod.yml"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
OUT="backups/tpx-$STAMP.dump"

$COMPOSE exec -T postgres sh -c 'pg_dump -U "${POSTGRES_USER:-tpx}" -d "${POSTGRES_DB:-tpx}" --format=custom' > "$OUT"

# un dump vide/tronqué ne doit pas écraser silencieusement la rotation
[ -s "$OUT" ] || { echo "dump vide: $OUT" >&2; rm -f "$OUT"; exit 1; }

find backups -name 'tpx-*.dump' -mtime +56 -delete
echo "ok $OUT ($(du -h "$OUT" | cut -f1))"
