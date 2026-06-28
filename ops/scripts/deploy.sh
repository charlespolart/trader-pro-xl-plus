#!/usr/bin/env bash
# Trigger the BACKEND deploy (GitHub Actions → GHCR → VPS).
#   ./ops/scripts/deploy.sh            # deploy HEAD
#   ./ops/scripts/deploy.sh abc1234    # roll back to a prior image tag
set -euo pipefail

tag="${1:-latest}"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI missing — brew install gh && gh auth login" >&2
  exit 1
fi

echo "==> Trigger backend deploy (tag=$tag)..."
gh workflow run deploy.yml -f tag="$tag"
sleep 3
echo "==> Tailing run..."
gh run watch
