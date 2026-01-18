# Router Operations Runbook

Audience: router operators and SREs.

## Purpose

Operate the router service safely, monitor health, and troubleshoot failures.

## Required configuration

- `ROUTER_ID`: logical router identifier.
- `ROUTER_KEY_ID`: public key ID (npub).
- `ROUTER_PRIVATE_KEY_PEM`: private key (nsec or 32-byte hex).
- `ROUTER_ENDPOINT`: public base URL.
- `ROUTER_PORT`: listen port.

## Optional configuration

- `ROUTER_REQUIRE_PAYMENT`: `true|false` to enforce payment receipts before inference.
- `ROUTER_NONCE_STORE_PATH`: file path for persisted replay nonces.
- `ROUTER_CLIENT_ALLOWLIST`: optional comma-separated npub allowlist for client requests.
- `ROUTER_CLIENT_BLOCKLIST`: optional comma-separated npub blocklist for client requests.
- `ROUTER_CLIENT_MUTE`: optional comma-separated npub mute list for client requests.
- `ROUTER_RATE_LIMIT_MAX`: max requests per key per window for ingress endpoints.
- `ROUTER_RATE_LIMIT_WINDOW_MS`: time window (ms) for ingress rate limiting.
- `ROUTER_LN_VERIFY_URL`: HTTP endpoint to verify Lightning settlement for receipts.
- `ROUTER_LN_VERIFY_TIMEOUT_MS`: verification timeout in ms.
- `ROUTER_LN_REQUIRE_PREIMAGE`: `true|false` to require receipt preimages.
- `ROUTER_LN_VERIFY_RETRY_MAX_ATTEMPTS`: max verification retries (default `1`).
- `ROUTER_LN_VERIFY_RETRY_MIN_DELAY_MS`: minimum retry delay in ms.
- `ROUTER_LN_VERIFY_RETRY_MAX_DELAY_MS`: maximum retry delay in ms.
- `ROUTER_LN_INVOICE_URL`: HTTP endpoint to generate Lightning invoices.
- `ROUTER_LN_INVOICE_TIMEOUT_MS`: invoice generation timeout in ms.
- `ROUTER_LN_INVOICE_RETRY_MAX_ATTEMPTS`: max invoice retries (default `1`).
- `ROUTER_LN_INVOICE_RETRY_MIN_DELAY_MS`: minimum retry delay in ms.
- `ROUTER_LN_INVOICE_RETRY_MAX_DELAY_MS`: maximum retry delay in ms.
- `ROUTER_LN_INVOICE_IDEMPOTENCY_HEADER`: idempotency header for invoice generation (default `Idempotency-Key`).
- `ROUTER_FEE_ENABLED`: `true|false` to add router fees to payment requests.
- `ROUTER_FEE_SPLIT`: `true|false` to include router fees as invoice splits.
- `ROUTER_FEE_BPS`: basis points added to invoice as router fee.
- `ROUTER_FEE_FLAT_SATS`: flat sats added to invoice as router fee.
- `ROUTER_FEE_MIN_SATS`: minimum router fee in sats.
- `ROUTER_FEE_MAX_SATS`: maximum router fee in sats.
- `ROUTER_DB_URL`: Postgres connection string for router persistence.
- `ROUTER_DB_SSL`: `true|false` to enable SSL for Postgres.
- `ROUTER_PAYMENT_RECONCILE_INTERVAL_MS`: reconciliation interval (ms) for missing receipts.
- `ROUTER_PAYMENT_RECONCILE_GRACE_MS`: grace window (ms) added to payment request expiry.
- `ROUTER_NONCE_STORE_URL`: Postgres connection string for replay nonce storage.
- `ROUTER_TLS_CERT_PATH`: TLS cert path for HTTPS.
- `ROUTER_TLS_KEY_PATH`: TLS key path for HTTPS.
- `ROUTER_TLS_CA_PATH`: optional CA bundle for mTLS.
- `ROUTER_TLS_REQUIRE_CLIENT_CERT`: `true|false` to require client certs.
- `ROUTER_STATE_PATH`: file path for persisting router state across restarts.
- `ROUTER_STATE_PERSIST_MS`: interval (ms) between state snapshots (default 5000).
- `ROUTER_FEDERATION_ENABLED`: `true|false` to enable federation endpoints.
- `ROUTER_FEDERATION_ENDPOINT`: public federation base URL.
- `ROUTER_FEDERATION_MAX_SPEND_MSAT`: optional spend cap for offloads.
- `ROUTER_FEDERATION_MAX_OFFLOADS`: optional max inflight offloads.
- `ROUTER_FEDERATION_MAX_PL`: max privacy level accepted (`PL0`-`PL3`).
- `ROUTER_FEDERATION_RATE_LIMIT_MAX`: max inbound federation control messages per peer per window.
- `ROUTER_FEDERATION_RATE_LIMIT_WINDOW_MS`: time window (ms) for inbound federation rate limiting.
- `ROUTER_FEDERATION_PEERS`: comma-separated peer URLs for outbound publishing.
- `ROUTER_FEDERATION_PUBLISH_INTERVAL_MS`: publish interval for federation announcements.
- `ROUTER_FEDERATION_NOSTR`: enable Nostr relay publish/subscribe for federation control-plane.
- `ROUTER_FEDERATION_NOSTR_RELAYS`: comma-separated Nostr relay URLs (optional; defaults to discovery list).
- `ROUTER_FEDERATION_NOSTR_PUBLISH_INTERVAL_MS`: publish cadence for caps/price/status events.
- `ROUTER_FEDERATION_NOSTR_SUBSCRIBE_SINCE_SEC`: history window in seconds when subscribing.
- `ROUTER_FEDERATION_NOSTR_ALLOWED_PEERS`: optional comma-separated npub allowlist (open by default).
- `ROUTER_FEDERATION_NOSTR_FOLLOW`: optional comma-separated npub follow list (biases WoT and relay subscriptions).
- `ROUTER_FEDERATION_NOSTR_MUTE`: optional comma-separated npub mute list (ignored inbound messages).
- `ROUTER_FEDERATION_NOSTR_BLOCK`: optional comma-separated npub block list (rejected inbound messages).
- `ROUTER_FEDERATION_NOSTR_RETRY_MIN_MS`: minimum backoff (ms) before retrying failed relays.
- `ROUTER_FEDERATION_NOSTR_RETRY_MAX_MS`: maximum backoff (ms) before retrying failed relays.
- `ROUTER_FEDERATION_NOSTR_WOT`: enable Web-of-Trust scoring for relay events.
- `ROUTER_FEDERATION_NOSTR_WOT_TRUSTED`: comma-separated npub list of trusted peers for WoT scoring.
- `ROUTER_FEDERATION_NOSTR_WOT_MIN_SCORE`: minimum WoT score required to accept events.
- `ROUTER_FEDERATION_NOSTR_MAX_CONTENT_BYTES`: max event content size before JSON parsing.
- `ROUTER_FEDERATION_DISCOVERY`: `true|false` to enable bootstrap peer discovery.
- `ROUTER_FEDERATION_BOOTSTRAP_PEERS`: comma-separated bootstrap peer URLs.
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
- `GET /status` should return `{ "ok": true }` plus node/payment counts.
- `GET /metrics` exposes Prometheus metrics.
- Federation endpoints should return `200` when enabled: `/federation/caps`, `/federation/price`, `/federation/status`.
- Self-publishing endpoints return signed messages when enabled: `/federation/self/caps`, `/federation/self/price`, `/federation/self/status`.
- Outbound publishing requires `ROUTER_FEDERATION_PEERS` and a non-empty local caps/price/status payload.
- Award acceptance returns `403` when the award target does not match this router.
- `/federation/payment-request` returns a signed payment request for a verified receipt.
- `/federation/payment-receipt` accepts a signed payment receipt for federation settlement.

## Observability

Key metrics:

- `router_inference_requests_total`
- `router_inference_duration_seconds`
- `router_payment_requests_total`
- `router_payment_receipt_failures_total`
- `router_payment_reconciliation_failures_total`
- `router_node_failures_total`
- `router_accounting_failures_total`
- `router_federation_relay_failures_total`

Tracing:

- `router.infer`
- `router.paymentReceipt`

## Operational checks

- Confirm relay discovery logs include expected sources and counts.
- Verify `/quote` and `/infer` return signed envelopes.
- Confirm payment enforcement matches `ROUTER_REQUIRE_PAYMENT`.
- If `ROUTER_REQUIRE_PAYMENT=true`, confirm `ROUTER_LN_INVOICE_URL` is configured and reachable.
- Ensure accounting failures are visible via `router_accounting_failures_total`.

## Troubleshooting

- `invalid-signature` or `key-id-mismatch`: confirm `ROUTER_KEY_ID` and private key alignment.
- `payment-required`: verify Lightning invoice and receipt workflow.
- `node-unreachable`: verify node endpoint networking and firewall rules.
- `invalid-metering` or signature failures: check node key config and signing path.
- `relay-discovery-expired`: regenerate manifest or adjust snapshot max age.

## Key rotation

1. Generate a new Nostr keypair (`nsec`/`npub`) and store it in your secret manager.
2. Update `ROUTER_KEY_ID` and `ROUTER_PRIVATE_KEY_PEM` to the new values.
3. Restart the router and confirm `/health` and `/status` are healthy.
4. Update any client allowlists and peer allowlists (federation or ingress) that reference the old key.
5. Re-publish federation caps/price/status and refresh manifests if needed.
