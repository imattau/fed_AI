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
- Service is independently deployable and exposes `/health`, `/register-node`, `/quote`, and `/infer`.

Health tracking
- Router tracks `lastHeartbeatMs` and filters stale nodes during selection.

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
