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
- Service is independently deployable and exposes `/health`, `/register-node`, `/quote`, `/infer`, and `/payment-receipt`.

Health tracking
- Router tracks `lastHeartbeatMs` and filters stale nodes during selection.

Payments
- When configured to require payment, `/infer` returns `402` with a signed `PaymentRequest` envelope.
- Clients submit a signed `PaymentReceipt` to `/payment-receipt` before retrying.
- Router attaches stored `PaymentReceipt` envelopes when forwarding requests to nodes.

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
