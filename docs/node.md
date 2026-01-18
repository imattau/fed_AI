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
- Service is independently deployable and exposes `/health`, `/status`, `/infer`, `/offload/rfb`, and `/offload/award`.

Heartbeat
- Nodes periodically sign and send `NodeDescriptor` updates to the router.
- Nodes can include optional `jobTypes` and `latencyEstimateMs` in advertised capabilities.

Payments
- When configured to require payment, `/infer` requires a client-signed `PaymentReceipt` envelope.
- Routers include the verified receipts inside the `paymentReceipts` array so downstream nodes can pick the one targeting them.
- Clients can issue receipts via `fedai receipt` and supply them on subsequent calls (e.g., `fedai infer ... --receipts node-receipt.json`).
- The receipt is forwarded by the router inside the inference payload.

Offload behavior
- When saturated or timing out, nodes can forward the original signed inference envelope to peer nodes (`NODE_OFFLOAD_PEERS`).
- Nodes can also ask the router to re-run scheduling via `/node/offload` (`NODE_OFFLOAD_ROUTER=true`), which may trigger the federation auction if the router has no local capacity.
- When `NODE_OFFLOAD_AUCTION=true`, nodes request bids from peer nodes before selecting an offload target.

Runner interface
- `listModels()`
- `infer(request)`
- `estimate(request)`
- `health()`

Runner selection
- Nodes default to the `http` runner for external inference backends.
- Set `NODE_RUNNER=http` plus `NODE_RUNNER_URL` to point at an HTTP-capable inference backend (for example a llama.cpp REST adapter).
- The HTTP runner expects `/models`, `/infer`, `/estimate`, and `/health` endpoints that accept JSON payloads and respond with `InferenceResponse`-shaped objects.
- Use `NODE_MODEL_ID` to override the default reported model ID for capability advertisements.
- `NODE_RUNNER=llama_cpp` targets a llama.cpp server; set `NODE_LLAMA_CPP_URL` (or `NODE_RUNNER_URL`) and ensure `/completion` is available.
- `NODE_RUNNER=vllm` targets a vLLM server (OpenAI-compatible); set `NODE_VLLM_URL` (or `NODE_RUNNER_URL`) and ensure `/v1/completions` is available.
- `NODE_RUNNER=openai` targets OpenAI-compatible APIs (OpenAI, Grok, DeepSeek); set `NODE_OPENAI_URL` + `NODE_OPENAI_API_KEY` and optionally `NODE_OPENAI_MODE=chat|completion`.
- `NODE_RUNNER=anthropic` targets Claude via Anthropic; set `NODE_ANTHROPIC_URL` + `NODE_ANTHROPIC_API_KEY`.

Rules
- Runners communicate via process spawn, IPC, or HTTP.
- Runners may be written in any language.
- Mock runner exists for testing only.

Observability
- `/metrics` exposes Prometheus counters and histograms such as `node_inference_requests_total` and `node_payment_receipt_failures_total`.
- The node wraps `/infer` with OpenTelemetry spans to tie inference handling into distributed traces.
- Node logs are redacted by default to avoid leaking prompt/output data or secrets.

Metering
- Track tokens in/out, wall time, bytes, model ID.
- Hash prompts instead of storing them.
- Sign `MeteringRecord` with node key.

Prohibitions
- No direct inference logic in Node.js.
- No prompt or output logging.

Configuration
- Core: `NODE_ID`, `NODE_KEY_ID` (npub), `NODE_PRIVATE_KEY_PEM` (nsec or hex), `NODE_ENDPOINT`, `NODE_PORT`.
- Router linkage: `ROUTER_ENDPOINT`, `ROUTER_PUBLIC_KEY_PEM` (npub or hex), `ROUTER_KEY_ID` (npub), `NODE_ROUTER_ALLOWLIST` (npub list).
- Offload: `NODE_OFFLOAD_PEERS` (comma-separated node endpoints), `NODE_OFFLOAD_ROUTER` (`true|false` to allow router fallback).
- Offload auction: `NODE_OFFLOAD_AUCTION` (`true|false`), `NODE_OFFLOAD_AUCTION_MS` (auction timeout for bids).
- Offload auction access: `NODE_OFFLOAD_AUCTION_ALLOWLIST` (npub list), `NODE_OFFLOAD_AUCTION_RATE_LIMIT` (requests per minute).
- Router preferences: `NODE_ROUTER_FOLLOW`, `NODE_ROUTER_MUTE`, `NODE_ROUTER_BLOCK` (npub lists).
- Runner: `NODE_RUNNER`, `NODE_RUNNER_URL`, `NODE_MODEL_ID`.
- Runner API keys: `NODE_RUNNER_API_KEY`, `NODE_OPENAI_API_KEY`, `NODE_VLLM_API_KEY`, `NODE_LLAMA_CPP_API_KEY`, `NODE_ANTHROPIC_API_KEY`.
- Capacity: `NODE_HEARTBEAT_MS`, `NODE_CAPACITY_MAX`, `NODE_CAPACITY_LOAD`.
- Limits: `NODE_MAX_PROMPT_BYTES`, `NODE_MAX_TOKENS`, `NODE_RUNNER_TIMEOUT_MS`, `NODE_MAX_REQUEST_BYTES`, `NODE_MAX_RUNTIME_MS`.
- Capability hints: `NODE_JOB_TYPES` (comma-separated RouterJobType values), `NODE_LATENCY_ESTIMATE_MS`.
- Lightning verification: `NODE_LN_VERIFY_URL`, `NODE_LN_VERIFY_TIMEOUT_MS`, `NODE_LN_REQUIRE_PREIMAGE`.
- TLS: `NODE_TLS_CERT_PATH`, `NODE_TLS_KEY_PATH`, `NODE_TLS_CA_PATH`, `NODE_TLS_REQUIRE_CLIENT_CERT`.
- Replay protection: `NODE_NONCE_STORE_PATH` to persist replay nonces across restarts.
- Replay protection (Postgres): `NODE_NONCE_STORE_URL`.
- Sandbox: `NODE_SANDBOX_MODE`, `NODE_SANDBOX_ALLOWED_RUNNERS`.
- Sandbox endpoints: `NODE_SANDBOX_ALLOWED_ENDPOINTS` (prefix allowlist).
- When `NODE_SANDBOX_MODE=restricted`, set explicit limits (`NODE_MAX_PROMPT_BYTES`, `NODE_MAX_TOKENS`, `NODE_MAX_REQUEST_BYTES`) or the node will refuse to start.
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
- [x] Enforce max runtime budget for runner calls.
- [x] Implement real runner adapters (llama.cpp, vLLM) with health and estimate support.
- [x] Provide OpenAI-compatible and Anthropic adapters for third-party hosted models.
- [ ] Wire secure runner spawning/IPC with restricted environment and file system access.
- [ ] Define and document production payment flows (LN invoices, keysend, receipt verification).
- [ ] Add node runbook steps for production deployment and key rotation.
- [ ] Add soak tests covering runner timeouts, backpressure, and payment-required scenarios.
