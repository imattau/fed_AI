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

Runner interface
- `listModels()`
- `infer(request)`
- `estimate(request)`
- `health()`

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
