#!/bin/sh
# PortfolioRunner — tick nocturne VPS (Phase B, GO Mario du 2026-07-17).
# S'exécute dans un CONTENEUR ÉPHÉMÈRE attaché au réseau des conteneurs
# existants : AUCUNE modification de l'image prod, aucun restart des bots,
# limite mémoire dure (si OOM c'est le tick qui meurt, jamais Postgres).
# Install (cron root VPS) :
#   (crontab -l 2>/dev/null; echo '20 1 * * * /srv/tpx-portfolio/repo/apps/backend/src/portfolio/nightly-vps.sh') | crontab -
# Kill switch : touch /srv/tpx-portfolio/portfolio.KILL
set -u
BASE=/srv/tpx-portfolio
REPO=$BASE/repo
LOG=$BASE/nightly.log
[ -f "$BASE/portfolio.KILL" ] && { echo "$(date -u +%FT%TZ) KILL actif — abstention" >> "$LOG"; exit 0; }
{
  echo "=== $(date -u +%FT%TZ) tick nocturne (VPS, conteneur éphémère) ==="
  docker run --rm --network tpx_default \
    --memory 500m --memory-swap 900m --cpus 1 \
    --env-file "$BASE/.env" \
    -e PORTFOLIO_TELEGRAM=1 \
    -v "$REPO":/app -v "$BASE/state":/app/apps/backend/src/portfolio/state \
    -w /app oven/bun:1 \
    sh -c 'bun apps/backend/src/portfolio/refresh.ts && bun apps/backend/src/portfolio/tick.ts table'
  echo "=== fin $(date -u +%FT%TZ) (exit $?) ==="
} >> "$LOG" 2>&1
