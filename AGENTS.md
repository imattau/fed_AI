Below is a single, complete, clean set of instructions for a coding AI. Nothing partial. Nothing implied. This is the canonical version to drop straight into the repo or into a "system prompt" for an autonomous coding agent.

---

# fed_AI - Repository Scaffolding & Build Instructions

Audience: Coding AI / autonomous agent
Scope: Full repo creation, architecture, constraints, and implementation order

---

## 1. Project intent

fed_AI is a Nostr-centric, decentralized, federated, pay-as-you-go AI inference network.

- Requests are routed across independently operated nodes.
- Nodes advertise capabilities, pricing, and capacity.
- A router selects nodes based on latency, cost, availability, and trust.
- The system prioritises low latency, competitive pricing, privacy, decentralisation, and modularity.
- No centralised inference provider. No vendor lock-in.

The system is explicitly split into:

- Control plane: routing, scheduling, metering, trust, protocol enforcement.
- Compute plane: model execution via external runners.

Nostr alignment
- Node identities use Nostr-compatible Ed25519 keys.
- Signed envelopes align with Nostr signing primitives.
- Discovery and trust can be relay-backed without exposing prompts or outputs.

---

## 2. Non-negotiable constraints

1. TypeScript is the control-plane language

   - Router, node orchestration, protocol, SDK, CLI, simulator are all TypeScript.
2. No inference in Node.js

   - Node services orchestrate runners only.
3. All services share one canonical protocol package

   - No duplicated types. No local redefinitions.
4. Runners are hot-swappable

   - Adding a new model backend must not require router changes.
5. Privacy by default

   - Prompts and outputs must not be logged.
6. Metering is cryptographically verifiable

   - Metering records are signed by node keys.
7. Simulator must reuse production scheduling logic

   - No re-implementations.

Optimise for correctness, economics, and evolvability before throughput.

---

## 2.1. Commenting and documentation requirements

Code comments
- Add comments when intent is non-obvious, especially for security, crypto, scheduling, or protocol validation logic.
- Keep comments concise and purposeful; avoid restating the code.
- Prefer short block comments over many inline comments when explaining a complex flow.

Documentation updates
- Update relevant docs for any behavior or contract change (protocol, node, router, CLI, simulator).
- Keep `docs/architecture.md`, `docs/protocol.md`, and `docs/data-handling.md` in sync with implementation changes.
- Add brief runbook notes for new operational steps or config flags.
- Maintain `docs/project-live.md` as the live implementation tracker: update active tasks, notes, and decisions as work progresses.
- Make frequent, logical commits to track progress; include clear, scoped commit messages.

---

## 3. Repository layout (create exactly this)

```
fed_ai/
  README.md
  LICENSE
  CONTRIBUTING.md
  SECURITY.md
  CODEOWNERS

  docs/
    overview.md
    architecture.md
    protocol.md
    node.md
    router.md
    pricing.md
    threat-model.md
    trust-and-attestation.md
    data-handling.md
    runbooks/
      local-dev.md
      release.md

  packages/
    protocol/
      src/
        envelope.ts
        types.ts
        validators.ts
        crypto.ts
        replay.ts
      tests/
      package.json
      tsconfig.json
      README.md

    sdk-js/
      src/
      tests/
      package.json
      README.md

  services/
    router/
      src/
        server.ts
        index.ts
        config.ts
        registry/
        scheduler/
        accounting/
        verify/
      tests/
      Dockerfile
      package.json
      README.md

    node/
      src/
        server.ts
        index.ts
        config.ts
        runners/
          types.ts
          mock/
          llama_cpp/
          vllm/
        sandbox/
        metering/
        registry/
      tests/
      Dockerfile
      package.json
      README.md

  tools/
    cli/
      src/
      package.json
      README.md

    simulator/
      src/
      package.json
      README.md

    scripts/
      dev.sh
      lint.sh
      test.sh
      gen-keys.sh

  infra/
    docker-compose.yml
    grafana/
    prometheus/
    otel/

  .github/
    workflows/
      ci.yml
      release.yml

  .editorconfig
  .gitignore
  pnpm-workspace.yaml
  package.json
  tsconfig.base.json
  eslint.config.js
  prettier.config.cjs
```

---

## 4. Technology defaults

- Node.js LTS
- TypeScript (strict mode)
- pnpm workspaces
- HTTP + JSON APIs (gRPC later if needed)
- OpenTelemetry hooks
- Prometheus metrics endpoints
- In-memory storage initially, abstracted behind interfaces

---

## 5. Canonical protocol package (packages/protocol)

This is the foundation. Everything depends on it.

### Must implement

#### Envelope

```
Envelope<T> {
  payload: T
  nonce: string
  ts: number
  keyId: string
  sig: string
}
```

#### Core types

- NodeDescriptor
- Capability
- ModelInfo
- QuoteRequest
- QuoteResponse
- InferenceRequest
- InferenceResponse
- MeteringRecord
- Attestation (v0.1 optional)

#### Crypto utilities

- signEnvelope()
- verifyEnvelope()
- Ed25519 by default

#### Replay protection

- Nonce tracking
- Timestamp window enforcement

#### Validation

- Runtime validators for every public type
- Reject invalid envelopes before business logic

Rules:

- No service may accept unsigned or unvalidated payloads.
- No service may define its own protocol types.

---

## 6. Node service (services/node)

### Purpose

Acts as a secure orchestrator for model runners.

### Responsibilities

- Expose router-only inference endpoint
- Manage runner lifecycle
- Enforce sandbox boundaries
- Collect and sign metering data
- Advertise capabilities via heartbeat

### Runner interface (mandatory)

Defined in runners/types.ts:

- listModels()
- infer(request)
- estimate(request)
- health()

Rules:

- Runners must communicate via process spawn, IPC, or HTTP.
- Runners may be written in any language.
- Mock runner exists for testing only.

### Metering

- Track tokens in/out, wall time, bytes, model ID.
- Hash prompts instead of storing them.
- Sign MeteringRecord with node key.

### Prohibitions

- No direct inference logic.
- No prompt or output logging.

---

## 7. Router service (services/router)

### Purpose

Acts as the decision and accounting engine.

### Responsibilities

- Node registry and health tracking
- Signature verification
- Quote generation
- Node selection and dispatch
- Metering aggregation

### Scheduling

- Implemented as pure functions.
- Located in src/scheduler/.
- Must be importable by the simulator.

Selection inputs:

- Latency estimates
- Pricing
- Current load
- Capacity
- Trust score

---

## 8. Simulator (tools/simulator)

### Purpose

Answer economic and scaling questions before production.

### Must do

- Generate synthetic nodes and workloads
- Reuse router scheduling logic directly
- Simulate queueing, drops, utilisation
- Output JSON results and Markdown summary

Metrics:

- p50 / p95 latency
- Cost per request
- Node utilisation
- Drop rate

---

## 9. CLI (tools/cli)

### Purpose

Human and automation interface.

### Must support

- Key generation
- Quote requests
- Signed inference requests
- Debug inspection (no payload leakage)

---

## 10. Local development (infra/docker-compose.yml)

Must include:

- Router
- Node with mock runner
- Optional observability stack

Expected commands:

- pnpm -w dev
- pnpm -w test
- pnpm -w lint
- pnpm -w sim
- pnpm -w cli infer

---

## 11. Security and privacy requirements

Docs required on day one:

- threat-model.md
- data-handling.md
- trust-and-attestation.md

Code must enforce:

- Default log redaction
- Signature verification everywhere
- Replay protection
- Signed metering records

---

## 12. CI requirements

On every PR:

1. Install dependencies
2. Lint
3. Unit tests
4. Build
5. Integration smoke test:

   - Start docker compose
   - Call router /health
   - Perform one signed inference
   - Verify metering acceptance

---

## 13. Implementation order (strict)

1. packages/protocol
2. services/node with mock runner
3. services/router registry and scheduler
4. tools/cli
5. infra/docker-compose.yml
6. tools/simulator
7. First real runner adapter

---

## 14. Design principle to follow throughout

Control plane stability enables compute plane freedom.

Never let model execution concerns leak into routing, pricing, or protocol design.

---

If you want, next step can be:

- A single docs/runbooks/local-dev.md written exactly for a coding agent
- Or a GitHub Issues breakdown that mirrors the implementation order
- Or a minimal "Phase 0 PoC" cut of this for fastest validation
