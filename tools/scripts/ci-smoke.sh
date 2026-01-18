#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
COMPOSE_FILE="$ROOT_DIR/infra/docker-compose.yml"
PAYMENT_REQUEST="$(mktemp)"
RECEIPT_FILE="$(mktemp)"

cleanup() {
  docker compose -f "$COMPOSE_FILE" down -v
  rm -f "$PAYMENT_REQUEST" "$RECEIPT_FILE"
}
trap cleanup EXIT

export LN_ADAPTER_BACKEND=mock

bash "$ROOT_DIR/tools/scripts/gen-keys.sh"

cat >> "$ENV_FILE" <<'EOF'
NODE_RUNNER=cpu
NODE_MODEL_ID=cpu-stats
NODE_CAPACITY_MAX=2
NODE_CAPACITY_LOAD=0
EOF

docker compose -f "$COMPOSE_FILE" up -d --build ln-adapter router node

for _ in $(seq 1 30); do
  if curl -fsS http://localhost:8080/health >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

for _ in $(seq 1 30); do
  if curl -fsS http://localhost:8081/health >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

CLIENT_KEY_ID="$(grep '^ROUTER_KEY_ID=' "$ENV_FILE" | cut -d= -f2)"
CLIENT_PRIVATE_KEY="$(grep '^ROUTER_PRIVATE_KEY_PEM=' "$ENV_FILE" | cut -d= -f2)"

set +e
pnpm --filter @fed-ai/cli dev -- infer \
  --router http://localhost:8080 \
  --key-id "$CLIENT_KEY_ID" \
  --private-key "$CLIENT_PRIVATE_KEY" \
  --model cpu-stats \
  --prompt "smoke-test" \
  --max-tokens 8 \
  --payment-request-out "$PAYMENT_REQUEST"
set -e

if [[ ! -s "$PAYMENT_REQUEST" ]]; then
  echo "Smoke test failed: payment request not captured." >&2
  exit 1
fi

pnpm --filter @fed-ai/cli dev -- receipt \
  --payment-request "$PAYMENT_REQUEST" \
  --key-id "$CLIENT_KEY_ID" \
  --private-key "$CLIENT_PRIVATE_KEY" \
  --router http://localhost:8080 \
  --write "$RECEIPT_FILE"

pnpm --filter @fed-ai/cli dev -- infer \
  --router http://localhost:8080 \
  --key-id "$CLIENT_KEY_ID" \
  --private-key "$CLIENT_PRIVATE_KEY" \
  --model cpu-stats \
  --prompt "smoke-test" \
  --max-tokens 8 \
  --receipts "$RECEIPT_FILE"
