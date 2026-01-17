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
- `NODE_RUNNER=llama_cpp` targets a llama.cpp server; set `NODE_LLAMA_CPP_URL` (or `NODE_RUNNER_URL`) and ensure `/completion` is available.
- `NODE_RUNNER=vllm` targets a vLLM server (OpenAI-compatible); set `NODE_VLLM_URL` (or `NODE_RUNNER_URL`) and ensure `/v1/completions` is available.

Rules
- Runners communicate via process spawn, IPC, or HTTP.
- Runners may be written in any language.
- Mock runner exists for testing only.

Observability
- `/metrics` exposes Prometheus counters and histograms such as `node_inference_requests_total` and `node_payment_receipt_failures_total`.
- The node wraps `/infer` with OpenTelemetry spans to tie inference handling into distributed traces.

Metering
- Track tokens in/out, wall time, bytes, model ID.
- Hash prompts instead of storing them.
- Sign `MeteringRecord` with node key.

Prohibitions
- No direct inference logic in Node.js.
- No prompt or output logging.

Configuration
- Core: `NODE_ID`, `NODE_KEY_ID`, `NODE_PRIVATE_KEY_PEM`, `NODE_ENDPOINT`, `NODE_PORT`.
- Router linkage: `ROUTER_ENDPOINT`, `ROUTER_PUBLIC_KEY_PEM`, `ROUTER_KEY_ID`.
- Runner: `NODE_RUNNER`, `NODE_RUNNER_URL`, `NODE_MODEL_ID`.
- Capacity: `NODE_HEARTBEAT_MS`, `NODE_CAPACITY_MAX`, `NODE_CAPACITY_LOAD`.
- Limits: `NODE_MAX_PROMPT_BYTES`, `NODE_MAX_TOKENS`, `NODE_RUNNER_TIMEOUT_MS`, `NODE_MAX_REQUEST_BYTES`.
- Sandbox: `NODE_SANDBOX_MODE`, `NODE_SANDBOX_ALLOWED_RUNNERS`.
- Sandbox endpoints: `NODE_SANDBOX_ALLOWED_ENDPOINTS` (prefix allowlist).
- Payments: `NODE_REQUIRE_PAYMENT`.

## Relay discovery

- Nodes also use `@fed-ai/nostr-relay-discovery` to gather relays for publishing capabilities or manifest updates.
- Support the same overrides: `NODE_RELAY_BOOTSTRAP`, `NODE_RELAY_AGGREGATORS`, `NODE_RELAY_TRUST`, `NODE_RELAY_MIN_SCORE`, and `NODE_RELAY_MAX_RESULTS`.
- Logs snapshot the top few relays at startup so operators can validate the choices before connecting to routers or relays.
- The manifest generation process embeds this discovery snapshot (under `relay_discovery`) so routers can audit exactly which relays were considered and when.

## Completion checklist

- [ ] Enforce sandbox policy (resource caps, allowlists, runner isolation per adapter). (Partial: runner allowlist supported.)
- [x] Enforce capacity limits and in-flight tracking for `/infer`.
- [x] Enforce prompt size and token limits at the node boundary.
- [x] Enforce total request size limits at the HTTP boundary.
- [x] Implement real runner adapters (llama.cpp, vLLM) with health and estimate support.
- [ ] Wire secure runner spawning/IPC with restricted environment and file system access.
- [ ] Define and document production payment flows (LN invoices, keysend, receipt verification).
- [ ] Add node runbook steps for production deployment and key rotation.
- [ ] Add soak tests covering runner timeouts, backpressure, and payment-required scenarios.
