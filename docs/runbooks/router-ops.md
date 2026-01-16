# Router Operations Runbook

Audience: router operators and SREs.

## Purpose

Operate the router service safely, monitor health, and troubleshoot failures.

## Required configuration

- `ROUTER_ID`: logical router identifier.
- `ROUTER_KEY_ID`: public key ID (Ed25519 hex).
- `ROUTER_PRIVATE_KEY_PEM`: private key (PEM or 32-byte hex).
- `ROUTER_ENDPOINT`: public base URL.
- `ROUTER_PORT`: listen port.

## Optional configuration

- `ROUTER_REQUIRE_PAYMENT`: `true|false` to enforce payment receipts before inference.
- `ROUTER_FEDERATION_ENABLED`: `true|false` to enable federation endpoints.
- `ROUTER_FEDERATION_ENDPOINT`: public federation base URL.
- `ROUTER_FEDERATION_MAX_SPEND_MSAT`: optional spend cap for offloads.
- `ROUTER_FEDERATION_MAX_OFFLOADS`: optional max inflight offloads.
- `ROUTER_FEDERATION_MAX_PL`: max privacy level accepted (`PL0`-`PL3`).
- `ROUTER_RELAY_BOOTSTRAP`: comma-separated relay URLs.
- `ROUTER_RELAY_AGGREGATORS`: comma-separated relay directory endpoints.
- `ROUTER_RELAY_TRUST`: comma-separated `url=score` entries.
- `ROUTER_RELAY_MIN_SCORE`: minimum relay score for discovery.
- `ROUTER_RELAY_MAX_RESULTS`: max relays to consider.
- `ROUTER_RELAY_SNAPSHOT_REQUIRED`: `true|false` for manifest promotion checks.
- `ROUTER_RELAY_SNAPSHOT_MAX_AGE_MS`: max age for relay discovery snapshots.

## Startup

```
pnpm --filter @fed-ai/router dev
```

Or via Docker Compose:

```
docker compose -f infra/docker-compose.yml up router
```

## Health checks

- `GET /health` should return `{ "ok": true }`.
- `GET /metrics` exposes Prometheus metrics.
- Federation endpoints should return `200` when enabled: `/federation/caps`, `/federation/price`, `/federation/status`.
- Self-publishing endpoints return signed messages when enabled: `/federation/self/caps`, `/federation/self/price`, `/federation/self/status`.

## Observability

Key metrics:

- `router_inference_requests_total`
- `router_inference_duration_seconds`
- `router_payment_requests_total`
- `router_payment_receipt_failures_total`
- `router_node_failures_total`
- `router_accounting_failures_total`

Tracing:

- `router.infer`
- `router.paymentReceipt`

## Operational checks

- Confirm relay discovery logs include expected sources and counts.
- Verify `/quote` and `/infer` return signed envelopes.
- Confirm payment enforcement matches `ROUTER_REQUIRE_PAYMENT`.
- Ensure accounting failures are visible via `router_accounting_failures_total`.

## Troubleshooting

- `invalid-signature` or `key-id-mismatch`: confirm `ROUTER_KEY_ID` and private key alignment.
- `payment-required`: verify Lightning invoice and receipt workflow.
- `node-unreachable`: verify node endpoint networking and firewall rules.
- `invalid-metering` or signature failures: check node key config and signing path.
- `relay-discovery-expired`: regenerate manifest or adjust snapshot max age.
