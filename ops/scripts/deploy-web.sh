#!/usr/bin/env bash
# Trigger the FRONT deploy (build + rsync to the VPS). Does NOT touch the backend.
#   ./ops/scripts/deploy-web.sh
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI missing — brew install gh && gh auth login" >&2
  exit 1
fi

echo "==> Trigger web deploy..."
gh workflow run deploy-web.yml
sleep 3
echo "==> Tailing run..."
gh run watch
