# Node Operations Runbook

Audience: node operators and SREs.

## Purpose

Operate the node service safely, monitor health, and troubleshoot failures.

## Required configuration

- `NODE_ID`: logical node identifier.
- `NODE_KEY_ID`: public key ID (npub).
- `NODE_PRIVATE_KEY_PEM`: private key (nsec or 32-byte hex).
- `NODE_ENDPOINT`: public base URL for router callbacks.
- `NODE_PORT`: listen port.
- `ROUTER_ENDPOINT`: router base URL for registration and heartbeat.
- `ROUTER_PUBLIC_KEY_PEM`: router public key (npub or 32-byte hex, optional if `ROUTER_KEY_ID` is set).
- `ROUTER_KEY_ID`: router public key ID (npub) to enforce key-id match.
- `NODE_ROUTER_ALLOWLIST`: optional comma-separated npub list to allow multiple routers.

## Optional configuration

- `NODE_RUNNER`: `http` (default), `llama_cpp`, `vllm`, `openai`, `anthropic`, or `cpu`.
- `NODE_RUNNER_URL`: HTTP runner base URL.
- `NODE_MODEL_ID`: override reported model ID for capability ads.
- `NODE_LLAMA_CPP_URL`: llama.cpp base URL (when `NODE_RUNNER=llama_cpp`).
- `NODE_VLLM_URL`: vLLM base URL (when `NODE_RUNNER=vllm`).
- `NODE_OPENAI_URL`: OpenAI-compatible base URL (when `NODE_RUNNER=openai`).
- `NODE_OPENAI_MODE`: `chat` or `completion`.
- `NODE_ANTHROPIC_URL`: Anthropic base URL (when `NODE_RUNNER=anthropic`).
- `NODE_RUNNER_API_KEY`: shared API key (used by HTTP/llama/vllm/openai/anthropic runners).
- `NODE_OPENAI_API_KEY`: override API key for OpenAI-compatible runners.
- `NODE_VLLM_API_KEY`: override API key for vLLM runner.
- `NODE_LLAMA_CPP_API_KEY`: override API key for llama.cpp runner.
- `NODE_ANTHROPIC_API_KEY`: override API key for Anthropic runner.
- `NODE_HEARTBEAT_MS`: heartbeat interval in ms.
- `NODE_CAPACITY_MAX`: max concurrent jobs.
- `NODE_CAPACITY_LOAD`: initial load hint.
- `NODE_MAX_PROMPT_BYTES`: reject prompts above this byte size.
- `NODE_MAX_TOKENS`: reject requests above this token limit.
- `NODE_RUNNER_TIMEOUT_MS`: abort runner HTTP calls after this timeout.
- `NODE_MAX_REQUEST_BYTES`: reject requests above this total payload size.
- `NODE_MAX_RUNTIME_MS`: abort runner inference after this timeout.
- `NODE_JOB_TYPES`: comma-separated RouterJobType values for capability ads.
- `NODE_LATENCY_ESTIMATE_MS`: static latency estimate for capability ads.
- `NODE_NONCE_STORE_PATH`: file path for persisted replay nonces.
- `NODE_NONCE_STORE_URL`: Postgres connection string for replay nonce storage.
- `NODE_LN_VERIFY_URL`: HTTP endpoint to verify Lightning settlement for receipts.
- `NODE_LN_VERIFY_TIMEOUT_MS`: verification timeout in ms.
- `NODE_LN_REQUIRE_PREIMAGE`: `true|false` to require receipt preimages.
- `NODE_TLS_CERT_PATH`: TLS cert path for HTTPS.
- `NODE_TLS_KEY_PATH`: TLS key path for HTTPS.
- `NODE_TLS_CA_PATH`: optional CA bundle for mTLS.
- `NODE_TLS_REQUIRE_CLIENT_CERT`: `true|false` to require client certs.
- `NODE_SANDBOX_MODE`: `disabled` (default) or `restricted` to enforce allowlists.
- `NODE_SANDBOX_ALLOWED_RUNNERS`: comma-separated list of allowed runner names when restricted.
- `NODE_SANDBOX_ALLOWED_ENDPOINTS`: comma-separated list of allowed base URL prefixes for HTTP-based runners.
- `NODE_REQUIRE_PAYMENT`: `true|false` to require receipts.

When running with `NODE_SANDBOX_MODE=restricted`, you must set `NODE_MAX_PROMPT_BYTES`, `NODE_MAX_TOKENS`, and `NODE_MAX_REQUEST_BYTES` or the node will refuse to start.
- `NODE_RELAY_BOOTSTRAP`: comma-separated relay URLs.
- `NODE_RELAY_AGGREGATORS`: comma-separated relay directory endpoints.
- `NODE_RELAY_TRUST`: comma-separated `url=score` entries.
- `NODE_RELAY_MIN_SCORE`: minimum relay score for discovery.
- `NODE_RELAY_MAX_RESULTS`: max relays to consider.

## Startup

```
pnpm --filter @fed-ai/node dev
```

Or via Docker Compose:

```
docker compose -f infra/docker-compose.yml up node
```

## Health checks

- `GET /health` should return `{ "ok": true }`.
- `GET /status` should return `{ "ok": true }` plus runner health and capacity.
- `GET /metrics` exposes Prometheus metrics.

## Observability

Key metrics:

- `node_inference_requests_total`
- `node_inference_duration_seconds`
- `node_payment_receipt_failures_total`

Tracing:

- `node.infer`

## Operational checks

- Confirm heartbeat registration is accepted by the router.
- Verify inference responses and metering records are signed.
- Confirm payment enforcement matches `NODE_REQUIRE_PAYMENT`.

## Troubleshooting

- `router-public-key-missing`: set `ROUTER_PUBLIC_KEY_PEM`.
- `invalid-signature`: confirm router public key matches router key ID.
- `payment-required`: check receipt generation and inclusion.
- Runner failures: verify `NODE_RUNNER_URL` is reachable and supports the expected API.
