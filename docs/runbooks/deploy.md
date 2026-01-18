# Deployment Runbook

Audience: operators deploying router and node in non-local environments.

## Purpose

Provide a minimal deployment checklist that keeps security and observability intact.

## Before you deploy

- Generate Nostr secp256k1 keys per router/node.
- Store private keys in a secret manager (do not bake into images).
- Decide whether to enforce payment receipts (`ROUTER_REQUIRE_PAYMENT`, `NODE_REQUIRE_PAYMENT`).
- Configure relay discovery overrides if needed.

## Router deployment

Required environment:

- `ROUTER_ID`
- `ROUTER_KEY_ID`
- `ROUTER_PRIVATE_KEY_PEM`
- `ROUTER_ENDPOINT`
- `ROUTER_PORT`

Recommended environment:

- `ROUTER_REQUIRE_PAYMENT`
- `ROUTER_LN_INVOICE_URL`
- `ROUTER_LN_VERIFY_URL`
- `ROUTER_LN_INVOICE_RETRY_MAX_ATTEMPTS` and `ROUTER_LN_VERIFY_RETRY_MAX_ATTEMPTS` for provider retries
- `ROUTER_PAYMENT_RECONCILE_INTERVAL_MS` and `ROUTER_PAYMENT_RECONCILE_GRACE_MS` for reconciliation alerts
- `ROUTER_FEE_ENABLED` and `ROUTER_FEE_BPS` if charging router fees via split invoices
- Apply `infra/sql/router.sql` and `infra/sql/router-nonce.sql` before startup when using Postgres.
- `ROUTER_DB_URL`
- `ROUTER_MAX_REQUEST_BYTES`
- `ROUTER_*_RETENTION_MS` and `ROUTER_PRUNE_INTERVAL_MS` if you need custom retention windows
- `ROUTER_SCHEDULER_TOP_K` to bound candidate scoring cost
- `ROUTER_RELAY_*` overrides
- `ROUTER_RELAY_SNAPSHOT_REQUIRED`
- `ROUTER_FEDERATION_ENABLED`
- `ROUTER_FEDERATION_NOSTR` and `ROUTER_FEDERATION_NOSTR_RELAYS` when using relays for federation control-plane
- `ROUTER_FEDERATION_NOSTR_RETRY_MIN_MS` and `ROUTER_FEDERATION_NOSTR_RETRY_MAX_MS` to tune relay backoff
- `ROUTER_FEDERATION_RATE_LIMIT_MAX` and `ROUTER_FEDERATION_RATE_LIMIT_WINDOW_MS` for inbound control-plane throttling

## Node deployment

Required environment:

- `NODE_ID`
- `NODE_KEY_ID`
- `NODE_PRIVATE_KEY_PEM`
- `NODE_ENDPOINT`
- `NODE_PORT`
- `ROUTER_ENDPOINT`
- `ROUTER_PUBLIC_KEY_PEM`

Recommended environment:

- `NODE_RUNNER`
- `NODE_RUNNER_URL`
- `NODE_REQUIRE_PAYMENT`
- `NODE_LN_VERIFY_URL`
- `NODE_LN_VERIFY_RETRY_MAX_ATTEMPTS` for verification retries
- `NODE_ROUTER_FEE_MAX_BPS` when enforcing router fee caps
- Apply `infra/sql/node-nonce.sql` before startup when using Postgres nonce storage.
- `NODE_RELAY_*` overrides

## Smoke checks

- `GET /health` returns `{ "ok": true }`.
- `/metrics` reachable by Prometheus.
- Router accepts a signed `/register-node` envelope.
- Signed `/quote` and `/infer` work end-to-end.

## Security notes

- Rotate keys on compromise.
- Avoid logging prompts or outputs.
- Use HTTPS for all public endpoints.
