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
- Service is independently deployable and exposes `/health`, `/register-node`, `/manifest`, `/quote`, `/infer`, and `/payment-receipt`.

Health tracking
- Router tracks `lastHeartbeatMs` and filters stale nodes during selection.

Payments
- When configured to require payment, `/infer` returns `402` with a signed `PaymentRequest` envelope that includes invoice details for the payee.
- Router keeps the issued `PaymentRequest` per payee so receipts can be validated against amount, invoice, and request ID.
- Clients pay payees directly over Lightning, then either POST a `PaymentReceipt` to `/payment-receipt` or include signed receipts in the next inference attempt via `paymentReceipts`.
- CLI `fedai receipt` can turn a saved `PaymentRequest` into a signed receipt and optionally post it to `/payment-receipt`.
- Router verifies proofs and attaches stored `PaymentReceipt` envelopes when forwarding requests to nodes.
- Router never holds or forwards funds; it only orchestrates requirements and verification.

Observability
- `/metrics` exposes Prometheus-friendly metrics such as `router_inference_requests_total` and latency histograms.
- The router instruments `/infer` and `/payment-receipt` with OpenTelemetry spans (`router.infer`, `router.paymentReceipt`) so traces can correlate ingestion, payment verification, and node dispatch.

Manifests
- `/manifest` accepts signed node manifests for initial admission and weighting.
- Manifest capability bands adjust initial trust scores before routing decisions.

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

Scheduling guarantees
- Scheduling is policy-driven and expressed as pure functions.
- Simulator uses the same scheduling logic to ensure economic modeling matches production behavior.

## Relay discovery

- Routers call `@fed-ai/nostr-relay-discovery` at startup to expand beyond the hard-coded bootstrap relays.
- Override sources with `ROUTER_RELAY_BOOTSTRAP` (comma-separated relay URLs) and `ROUTER_RELAY_AGGREGATORS` (directory endpoints).
- Adjust scoring with `ROUTER_RELAY_TRUST` entries such as `wss://relay.example=5`.
- Tune filtering with `ROUTER_RELAY_MIN_SCORE` and `ROUTER_RELAY_MAX_RESULTS` as needed for conservative admission.
