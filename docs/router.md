# Router Service

Purpose
- Decision and accounting engine.

Responsibilities
- Node registry and health tracking.
- Signature verification.
- Quote generation.
- Node selection and dispatch.
- Metering aggregation.
- Use Nostr-compatible keys for verifying node envelopes.
- Service is independently deployable and exposes `/health`, `/status`, `/register-node`, `/manifest`, `/quote`, `/infer`, `/infer/stream`, `/node/offload`, and `/payment-receipt`.

Health tracking
- Router tracks `lastHeartbeatMs` and filters stale nodes during selection.
- Router tracks per-node success/failure history; consecutive failures trigger cooldown with backoff.
- Reliability penalties reduce trust scores once a minimum sample is reached.
- Router retries alternative nodes on inference failure when payment is not locked to a specific node.

Payments
- When configured to require payment, `/infer` and `/infer/stream` return `402` with a signed `PaymentRequest` envelope that includes invoice details for the payee.
- Router keeps the issued `PaymentRequest` per payee so receipts can be validated against amount, invoice, and request ID.
- Clients pay payees directly over Lightning, then either POST a `PaymentReceipt` to `/payment-receipt` or include signed receipts in the next inference attempt via `paymentReceipts`.
- CLI `fedai receipt` can turn a saved `PaymentRequest` into a signed receipt and optionally post it to `/payment-receipt`.
- Router verifies proofs and attaches stored `PaymentReceipt` envelopes when forwarding requests to nodes.
- Router never holds or forwards funds; it only orchestrates requirements and verification.
- When `ROUTER_REQUIRE_PAYMENT=true`, an invoice provider must be configured via `ROUTER_LN_INVOICE_URL`.

Observability
- `/metrics` exposes Prometheus-friendly metrics such as `router_inference_requests_total` and latency histograms.
- The router instruments `/infer`, `/infer/stream`, and `/payment-receipt` with OpenTelemetry spans (`router.infer`, `router.inferStream`, `router.paymentReceipt`) so traces can correlate ingestion, payment verification, and node dispatch.
- Accounting failures surface as `router_accounting_failures_total` with reason labels for metering/signature issues.
- Router logs are redacted by default to avoid leaking prompt/output data or secrets.

Worker threads
- Optional worker pools can offload envelope validation and signature checks to reduce main-thread latency under load.
- Enable only when CPU saturation or event-loop delay becomes visible in traces.

Configuration
- Core: `ROUTER_ID`, `ROUTER_KEY_ID` (npub), `ROUTER_PRIVATE_KEY_PEM` (nsec or hex), `ROUTER_ENDPOINT`, `ROUTER_PORT`.
- Payments: `ROUTER_REQUIRE_PAYMENT`.
- Lightning verification: `ROUTER_LN_VERIFY_URL`, `ROUTER_LN_VERIFY_TIMEOUT_MS`, `ROUTER_LN_REQUIRE_PREIMAGE`, `ROUTER_LN_VERIFY_RETRY_MAX_ATTEMPTS`, `ROUTER_LN_VERIFY_RETRY_MIN_DELAY_MS`, `ROUTER_LN_VERIFY_RETRY_MAX_DELAY_MS`.
- Lightning invoice generation: `ROUTER_LN_INVOICE_URL`, `ROUTER_LN_INVOICE_TIMEOUT_MS`, `ROUTER_LN_INVOICE_RETRY_MAX_ATTEMPTS`, `ROUTER_LN_INVOICE_RETRY_MIN_DELAY_MS`, `ROUTER_LN_INVOICE_RETRY_MAX_DELAY_MS`, `ROUTER_LN_INVOICE_IDEMPOTENCY_HEADER`.
- Router fee policy: `ROUTER_FEE_ENABLED`, `ROUTER_FEE_SPLIT`, `ROUTER_FEE_BPS`, `ROUTER_FEE_FLAT_SATS`, `ROUTER_FEE_MIN_SATS`, `ROUTER_FEE_MAX_SATS`.
- Database: `ROUTER_DB_URL`, `ROUTER_DB_SSL` (retention settings also apply to the Postgres store load/cleanup).
- Replay protection: `ROUTER_NONCE_STORE_PATH` to persist replay nonces across restarts.
- Replay protection (Postgres): `ROUTER_NONCE_STORE_URL`.
- Request sizing: `ROUTER_MAX_REQUEST_BYTES` to cap inbound JSON payloads.
- Client access control: `ROUTER_CLIENT_ALLOWLIST`, `ROUTER_CLIENT_BLOCKLIST`, `ROUTER_CLIENT_MUTE`.
- Ingress rate limit: `ROUTER_RATE_LIMIT_MAX`, `ROUTER_RATE_LIMIT_WINDOW_MS`.
- Worker threads: `ROUTER_WORKER_THREADS_ENABLED`, `ROUTER_WORKER_THREADS_MAX`, `ROUTER_WORKER_THREADS_QUEUE_MAX`, `ROUTER_WORKER_THREADS_TIMEOUT_MS`.
- TLS: `ROUTER_TLS_CERT_PATH`, `ROUTER_TLS_KEY_PATH`, `ROUTER_TLS_CA_PATH`, `ROUTER_TLS_REQUIRE_CLIENT_CERT`.
- Persistence: `ROUTER_STATE_PATH`, `ROUTER_STATE_PERSIST_MS`.
- Retention/pruning: `ROUTER_PAYMENT_REQUEST_RETENTION_MS`, `ROUTER_PAYMENT_RECEIPT_RETENTION_MS`, `ROUTER_PAYMENT_RECONCILE_INTERVAL_MS`, `ROUTER_PAYMENT_RECONCILE_GRACE_MS`, `ROUTER_FEDERATION_JOB_RETENTION_MS`, `ROUTER_NODE_HEALTH_RETENTION_MS`, `ROUTER_NODE_COOLDOWN_RETENTION_MS`, `ROUTER_NODE_RETENTION_MS`, `ROUTER_PRUNE_INTERVAL_MS`.
- Scheduling: `ROUTER_SCHEDULER_TOP_K` to cap the number of scored candidates per request.
- Federation: `ROUTER_FEDERATION_ENABLED`, `ROUTER_FEDERATION_ENDPOINT`, `ROUTER_FEDERATION_MAX_SPEND_MSAT`, `ROUTER_FEDERATION_MAX_OFFLOADS`, `ROUTER_FEDERATION_MAX_PL`, `ROUTER_FEDERATION_RATE_LIMIT_MAX`, `ROUTER_FEDERATION_RATE_LIMIT_WINDOW_MS`, `ROUTER_FEDERATION_PEERS`, `ROUTER_FEDERATION_PUBLISH_INTERVAL_MS`, `ROUTER_FEDERATION_REQUEST_TIMEOUT_MS`, `ROUTER_FEDERATION_PUBLISH_CONCURRENCY`, `ROUTER_FEDERATION_AUCTION_CONCURRENCY`, `ROUTER_FEDERATION_NOSTR`, `ROUTER_FEDERATION_NOSTR_RELAYS`, `ROUTER_FEDERATION_NOSTR_PUBLISH_INTERVAL_MS`, `ROUTER_FEDERATION_NOSTR_SUBSCRIBE_SINCE_SEC`, `ROUTER_FEDERATION_NOSTR_ALLOWED_PEERS`, `ROUTER_FEDERATION_NOSTR_FOLLOW`, `ROUTER_FEDERATION_NOSTR_MUTE`, `ROUTER_FEDERATION_NOSTR_BLOCK`, `ROUTER_FEDERATION_NOSTR_RETRY_MIN_MS`, `ROUTER_FEDERATION_NOSTR_RETRY_MAX_MS`, `ROUTER_FEDERATION_NOSTR_WOT`, `ROUTER_FEDERATION_NOSTR_WOT_TRUSTED`, `ROUTER_FEDERATION_NOSTR_WOT_MIN_SCORE`, `ROUTER_FEDERATION_NOSTR_MAX_CONTENT_BYTES`, `ROUTER_FEDERATION_DISCOVERY`, `ROUTER_FEDERATION_BOOTSTRAP_PEERS`.
- Relay discovery: `ROUTER_RELAY_BOOTSTRAP`, `ROUTER_RELAY_AGGREGATORS`, `ROUTER_RELAY_TRUST`, `ROUTER_RELAY_MIN_SCORE`, `ROUTER_RELAY_MAX_RESULTS`.
- Relay snapshot admission: `ROUTER_RELAY_SNAPSHOT_REQUIRED`, `ROUTER_RELAY_SNAPSHOT_MAX_AGE_MS`.

Manifests
- `/manifest` accepts signed node manifests for initial admission and weighting.
- Manifest capability bands adjust initial trust scores before routing decisions.
- Manifest-based trust decays as observed performance data accumulates.

Staking
- `/stake/commit` records stake commitments signed by node or router keys.
- `/stake/slash` applies deterministic slashing signed by the router key.
- Stake units influence routing weights but never override performance signals.

Scheduling
- Pure functions under `services/router/src/scheduler`.
- Must be importable by the simulator.

Selection inputs
- Latency estimates
- Pricing
- Current load
- Capacity
- Trust score
- Job type compatibility (when `InferenceRequest.jobType` is set)
- Context window availability (estimated prompt + max tokens must fit `Capability.contextWindow`).
- Observed performance bonus (bounded) and reliability penalties.

Scheduling guarantees
- Scheduling is policy-driven and expressed as pure functions.
- Simulator uses the same scheduling logic to ensure economic modeling matches production behavior.

## Federation (early implementation)

- Control-plane endpoints: `/federation/caps`, `/federation/price`, `/federation/status`, `/federation/rfb`, `/federation/bid`, `/federation/award`.
- Data-plane endpoints: `/federation/job-submit`, `/federation/job-result` require signed envelopes and replay protection.
- Self-publishing helpers: `/federation/self/caps`, `/federation/self/price`, `/federation/self/status` return signed messages.
- `/federation/rfb` responds with a signed `BID` only when privacy, pricing, and backpressure checks pass.
- `/federation/award` rejects awards not targeted to this router and acknowledges accepted awards.
- `/federation/payment-request` issues a signed `PaymentRequest` for a verified federation receipt.
- Award selection helpers choose a winner from bids before posting to `/federation/award`.
- Auction orchestration uses an RFB → BID → AWARD loop with helper utilities.
- `/federation/payment-receipt` accepts signed payment receipts for federation payment requests.
- Federation jobs track settlement state for payment requests and receipts.
- `/infer` attempts federation offload (auction + job submit) when no local nodes are available.
- `/federation/job-submit` returns inline inference results when the payload is a JSON-encoded `InferenceRequest`.
- Enable with `ROUTER_FEDERATION_ENABLED=true` and set `ROUTER_FEDERATION_ENDPOINT`.

## Relay discovery

- Routers call `@fed-ai/nostr-relay-discovery` at startup to expand beyond the hard-coded bootstrap relays.
- Override sources with `ROUTER_RELAY_BOOTSTRAP` (comma-separated relay URLs) and `ROUTER_RELAY_AGGREGATORS` (directory endpoints).
- Adjust scoring with `ROUTER_RELAY_TRUST` entries such as `wss://relay.example=5`.
- Tune filtering with `ROUTER_RELAY_MIN_SCORE` and `ROUTER_RELAY_MAX_RESULTS` as needed for conservative admission.
- When `ROUTER_RELAY_SNAPSHOT_REQUIRED=true`, manifests must include a recent `relay_discovery` snapshot before capability bands can promote trust weighting.
- Set `ROUTER_RELAY_SNAPSHOT_MAX_AGE_MS` to cap snapshot freshness for admission checks.
