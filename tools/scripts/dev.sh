#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [ ! -f "$ROOT_DIR/.env" ]; then
  "$ROOT_DIR/tools/scripts/gen-keys.sh"
fi

docker compose -f "$ROOT_DIR/infra/docker-compose.yml" up
