# Deployment Runbook

Audience: operators deploying router and node in non-local environments.

## Purpose

Provide a minimal deployment checklist that keeps security and observability intact.

## Before you deploy

- Generate Ed25519 keys per router/node.
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
- `ROUTER_DB_URL`
- `ROUTER_RELAY_*` overrides
- `ROUTER_RELAY_SNAPSHOT_REQUIRED`
- `ROUTER_FEDERATION_ENABLED`

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
