# Node Service

Purpose
- Secure orchestrator for model runners.

Responsibilities
- Expose router-only inference endpoint.
- Manage runner lifecycle.
- Enforce sandbox boundaries.
- Collect and sign metering data.
- Advertise capabilities via heartbeat.
- Use Nostr-compatible keys for node identity and signing.
- Service is independently deployable and exposes `/health` and `/infer`.

Heartbeat
- Nodes periodically sign and send `NodeDescriptor` updates to the router.

Payments
- When configured to require payment, `/infer` requires a client-signed `PaymentReceipt` envelope.
- Routers include the verified receipts inside the `paymentReceipts` array so downstream nodes can pick the one targeting them.
- Clients can issue receipts via `fedai receipt` and supply them on subsequent calls (e.g., `fedai infer ... --receipts node-receipt.json`).
- The receipt is forwarded by the router inside the inference payload.

Runner interface
- `listModels()`
- `infer(request)`
- `estimate(request)`
- `health()`

Runner selection
- Nodes default to the `mock` runner for fast local testing.
- Set `NODE_RUNNER=http` plus `NODE_RUNNER_URL` to point at an HTTP-capable inference backend (for example a llama.cpp REST adapter).
- The HTTP runner expects `/models`, `/infer`, `/estimate`, and `/health` endpoints that accept JSON payloads and respond with `InferenceResponse`-shaped objects.
- Use `NODE_MODEL_ID` to override the default reported model ID for capability advertisements.

Rules
- Runners communicate via process spawn, IPC, or HTTP.
- Runners may be written in any language.
- Mock runner exists for testing only.

Metering
- Track tokens in/out, wall time, bytes, model ID.
- Hash prompts instead of storing them.
- Sign `MeteringRecord` with node key.

Prohibitions
- No direct inference logic in Node.js.
- No prompt or output logging.
