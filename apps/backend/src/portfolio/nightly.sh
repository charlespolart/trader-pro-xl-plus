#!/bin/sh
# PortfolioRunner — tick nocturne LOCAL (Phase B, marche à blanc paper).
# RÈGLE : jamais sur le VPS sans GO explicite de Mario (2026-07-17).
# Install (cron local, 02:30 heure locale) :
#   (crontab -l 2>/dev/null; echo '30 2 * * * /Users/charlespolart/Documents/Coding/trader-pro-xl-plus/apps/backend/src/portfolio/nightly.sh') | crontab -
# Désinstall : crontab -e et retirer la ligne. Kill switch : toucher portfolio.KILL à la racine.
set -u
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT" || exit 1
set -a; [ -f apps/backend/.env ] && . apps/backend/.env; set +a
export PORTFOLIO_TELEGRAM="${PORTFOLIO_TELEGRAM:-1}"
LOG="$ROOT/apps/backend/src/portfolio/nightly.log"
BUN="$(command -v bun || echo "$HOME/.bun/bin/bun")"
{
  echo "=== $(date -u +%FT%TZ) tick nocturne (local) ==="
  "$BUN" apps/backend/src/portfolio/refresh.ts
  "$BUN" apps/backend/src/portfolio/tick.ts table
  echo "=== fin $(date -u +%FT%TZ) ==="
} >> "$LOG" 2>&1
