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

# Les données de MARCHÉ (bougies, funding, manifeste aggtrades) sont exclues :
# re-téléchargeables à volonté depuis Binance Vision (ensureRange les refait à
# la demande après un restore). Ne reste que l'irremplaçable — bots, trades,
# ordres, fills, clés API chiffrées, réglages — soit ~quelques dizaines de Ko
# par dump (mesuré : 40 Mo avec le marché → 0,02 Mo sans). Avec la rotation
# 8 dumps, l'espace disque total est borné à quelques Mo pour toujours.
$COMPOSE exec -T postgres sh -c 'pg_dump -U "${POSTGRES_USER:-tpx}" -d "${POSTGRES_DB:-tpx}" --format=custom \
  --exclude-table-data=candles --exclude-table-data=candle_coverage \
  --exclude-table-data=funding_rates --exclude-table-data=aggtrade_files' > "$OUT"

# un dump vide/tronqué ne doit pas écraser silencieusement la rotation
[ -s "$OUT" ] || { echo "dump vide: $OUT" >&2; rm -f "$OUT"; exit 1; }

find backups -name 'tpx-*.dump' -mtime +56 -delete
echo "ok $OUT ($(du -h "$OUT" | cut -f1))"
