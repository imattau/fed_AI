# Live Project Status

Purpose
- Track implementation plan, active tasks, and scratchpad notes for coding agents.

Planning principles
- Validate economics and behavior before scaling infrastructure.
- Lock the protocol early; evolve everything else behind it.
- Prefer small, verifiable increments over big launches.
- Treat the simulator as a first-class deliverable.

## Implementation plan

1. packages/protocol
2. services/node with mock runner
3. services/router registry and scheduler
4. tools/cli
5. packages/profiler, bench, recommender, manifest
6. infra/docker-compose.yml
7. tools/simulator
8. First real runner adapter

## Phased roadmap

Phase 0 - Foundations and invariants
- Repo scaffold, canonical protocol, crypto envelope/validation, security baseline
- Exit: protocol types compile, envelopes sign/verify, no ad-hoc types

Phase 1 - Minimal network loop
- Router + node with mock runner + CLI + docker compose
- Exit: signed inference round-trip with metering verification

Phase 2 - Scheduling and pricing logic
- Scheduler pure functions, quote flow, pricing/capacity descriptors
- Exit: multi-node selection and testable scheduling

Phase 3 - Simulator and economic validation
- Simulator reuses scheduler, produces JSON/Markdown reports
- Exit: stable metrics and operator viability insights

Phase 4 - Real runner integration
- First real runner adapter, sandbox boundaries, mixed networks
- Exit: real inference end-to-end without router changes

Phase 5 - Trust, resilience, abuse resistance
- Trust scoring hooks, failure handling, replay hardening
- Exit: graceful degradation, no silent accounting failures, and v0.1 router federation spec drafted

Phase 6 - Operational readiness
- Runbooks, observability, CLI ergonomics, operator docs
- Exit: third-party can run a node with diagnosable behavior

Phase 7 - Optional extensions
- Streaming inference, peer discovery, reputation, settlement, chained nodes

## Active tasks

- [x] Phase PR-1: authZ policy modules and ingress rate limits.
  - [x] Add authZ policy helpers for router/node ingress.
  - [x] Add ingress rate limiting for router/node endpoints.
  - [x] Add key rotation steps to router/node runbooks.
  - [x] Map threat-model mitigations to code references.
- [x] Phase PR-2: payments and settlement hardening.
  - [x] Add retries + idempotency for Lightning invoice creation.
  - [x] Add retries for payment verification checks.
  - [x] Add reconciliation alerts for missing/expired receipts.
  - [x] Add settlement verification tests to CI.
- [x] Phase PR-3: reliability and durability.
  - [x] Add SQL migrations and backup scripts for router/node Postgres storage.
  - [x] Add load/soak simulations covering timeouts, backpressure, and offload/auction behavior.
  - [x] Add chaos-lite scenarios for relay failures and peer flapping.
- [x] Phase PR-4: observability and operations.
  - [x] Expand dashboards and alert thresholds for payment health.
  - [x] Add correlation IDs to router/node request handling.
  - [x] Finalize incident/rollback runbooks.
- [x] Phase PR-5: release readiness.
  - [x] Add protocol/SDK version bump checks in CI.
  - [x] Add production deployment manifest(s) and usage notes.
  - [x] Add pre-release security review checklist.
- [x] Phase PR-6: CI integration smoke test.
  - [x] Add CI smoke script to start compose and run signed inference + payment receipt.
- [x] First real runner adapter (HTTP-backed).
- [x] Plug the discovered relay list into manifest publication/advertisement flows to help routers/nodes publish to peers.
- [x] Production hardening: settlement verification and state storage.
- [x] Scheduling upgrades (latency + job types) and protocol alignment.
- [x] Router invoice generation hook for Lightning-backed invoices (replaces mock when configured).
- [x] Router store backed by Postgres for nodes, payments, and manifests (configurable).
- [x] Performance hardening: async persistence, nonce store debouncing, scheduler cache.
- [x] Postgres-backed replay nonce store option for router/node.
- [x] Performance audit remediation: add router request size limits and 413 handling.
- [x] Performance audit remediation: prune in-memory maps + persistence snapshot (payments, receipts, federation jobs, health) with TTLs.
- [x] Performance audit remediation: add retention/paging to router Postgres store load and cleanup.
- [x] Performance audit remediation: add request timeouts + limited parallelism for federation publish/auction.
- [x] Performance audit remediation: reduce scheduler sort work with top-k selection or cached scores per job type.
- [x] SDK ergonomics: key derivation helper, payment retry helper, diagnostics endpoints, richer errors.
- [x] SDK discovery helpers (router + relay) and configurable HTTP retry.
- [x] SDK core client helpers: node filters, batch quotes, config validation, error parsing utilities.
- [x] SDK payments ops helpers: split accounting, receipt matching, reconciliation utilities, per-request retries.
- [x] SDK federation helpers: caps/price/status/job + settlement endpoints.
- [x] SDK long-running helpers: polling utility and per-request timeout/cancellation support.
- [x] Streaming inference endpoints for router/node with SSE and SDK helpers.
- [x] Optional worker-thread pools for envelope validation and signature verification in router/node.
- [x] Context window enforcement using prompt token estimates in router selection and node validation.

## Upcoming tasks

- [x] Expanded trust/resilience handling.
- [x] Add router admission checks that verify `relay_discovery` snapshots before promotion.
- [x] Draft Router Federation Spec v0.1 (router-to-router offload + auctioning, privacy levels, receipts, settlement, and backpressure rules).
- [x] Phase 6: operator runbooks + observability checklist + CLI ergonomics pass.
- [x] Federation data-plane auth: require signed envelopes + replay checks for job submit/result.
- [x] Enforce award/capacity checks before accepting federation jobs; reject expired awards and over-cap receipts.
- [x] Router offload path: integrate federation posted price/auction fallback into `/infer`.
- [x] Federation settlement validation: only issue payment requests for known jobs/receipts.
- [x] HTTP runner timeout enforcement.

## Decisions and notes

- Keep control-plane code TypeScript-only.
- No prompt/output logging; hash prompts for metering.
- All inbound/outbound payloads must be signed envelopes.
- Nostr-compatible identities and signing are required across the control plane.
- Settlement is peer-to-peer over Lightning; routers coordinate requirements but never custody funds.
- Discovery uses Nostr relays; operational inference traffic is peer-to-peer between client, router, and node.
- Project summary aligned in `README.md`, `docs/overview.md`, and `docs/architecture.md`.

## Success definition

- Users can buy inference without trusting operators.
- Operators can earn revenue without platform lock-in.
- Routing is explainable, testable, reproducible.
- Scaling assumptions are validated by simulation.

## Production readiness checklist (draft)

Security and auth
- [x] End-to-end authZ policy model for routers and nodes (allowlist + WoT + rate limits).
- [ ] Key rotation workflows and runbooks (router/node/client keys).
- [x] Hardened request validation (schema + size + replay) for all public endpoints.
- [x] Threat-model review pass with concrete mitigations mapped to code.

Payments and settlement
- [x] Production Lightning invoice integration (LNBits/LND/CLN/NWC) with retries + idempotency.
- [ ] Payment reconciliation + dispute handling runbook.
- [ ] Signed receipt lifecycle alerts (late/invalid receipts, mismatched invoices).

Reliability and data
- [x] Persistent storage for registry, metering, receipts, auctions (migrations + backups).
- [x] Load testing + soak testing for node/router (timeouts, backpressure, offload).
- [ ] Chaos/chaos-lite tests for relay failures and peer flapping.

Observability and ops
- [x] Production dashboards and alert thresholds (SLOs for latency, error rate, payment failures).
- [x] Structured logging policy (redaction, correlation IDs, audit trails).
- [ ] On-call runbooks (incident response + escalation).

Release and deployment
- [x] CI integration smoke tests (compose + signed inference + metering).
- [ ] Versioning and compatibility policy for protocol + SDK.
- [x] Deployment manifests for router/node/observability stacks (prod-ready).

## Production readiness plan (tasks)

Phase PR-1: Security baseline
- Implement authZ policy modules for router/node ingress.
- Add key rotation tooling and docs.
- Enforce rate limits across all public endpoints.
- Map threat-model items to mitigations with code references.

Phase PR-2: Payments and settlement hardening
- Integrate real LN providers with retries and idempotent payment requests.
- Add reconciliation pipeline and alerting for receipt anomalies.
- Add automated settlement verification tests in CI.

Phase PR-3: Reliability and durability
- Finalize durable storage with migrations + backups.
- Add load/soak tests and chaos scenarios.
- Validate offload/auction behavior under sustained load.

Phase PR-4: Observability and operations
- Ship production dashboards and alert SLOs.
- Add audit logging and correlation IDs.
- Finalize runbooks for incidents, upgrades, and rollbacks.

Phase PR-5: Release readiness
- Add compatibility checks for protocol/SDK changes.
- Finalize deployment manifests and version pinning.
- Complete pre-release security review.

## Completed

- [x] Repository scaffolding and file layout created.
- [x] Initial docs drafted (`docs/*.md`) and runbooks scaffolded.
- [x] Workspace wiring and configs added.
- [x] Live project tracker created and referenced in `AGENTS.md`.
- [x] Protocol package core types, validators, crypto, replay utilities, and exports implemented.
- [x] Protocol package tests added with `node:test`.
- [x] Node and router scaffolds added (runner types, mock runner, scheduler skeleton).
- [x] Node and router services expose minimal HTTP servers with signed envelope validation.
- [x] Key parsing utilities added (nsec/npub or 32-byte hex secp256k1).
- [x] Router node registration now verifies signatures and replay protection.
- [x] Router inference dispatch endpoint with response and metering verification.
- [x] Node and router HTTP handlers return structured errors for invalid JSON.
- [x] Node and router HTTP tests added for core flows.
- [x] Scheduler scoring and router quote endpoint added.
- [x] Node heartbeat registration and router health filtering added.
- [x] Router quote endpoint tests added.
- [x] CLI key generation, quote, and inference flows implemented.
- [x] CLI docs and usage examples added.
- [x] CLI unit tests added.
- [x] Protocol payment and error types added with validators and tests.
- [x] Docker compose wired for end-to-end local run.
- [x] Protocol docs include payment lifecycle guidance.
- [x] Router payment enforcement added with receipt endpoint and tests.
- [x] Simulator uses router scheduler and emits JSON + Markdown summary.
- [x] Node payment enforcement added with receipt verification.
- [x] CLI supports profile/bench/recommend/manifest commands.
- [x] Profiler, bench, recommender, and manifest packages implemented.
- [x] Router manifest ingestion and weighting added.
- [x] Staking components added (stake commits, slashing, routing weights).
- [x] Simulator pricing sensitivity scenario added.
- [x] Simulator payment flow scenario added (pay-before vs pay-after with receipt counts).
- [x] P2P Lightning payment documentation updated across core docs.
- [x] Observability hooks (metrics + tracing) added for router and node.
- [x] Router/node startup logs the `discoverRelays` candidate set and respects discovery env overrides.
- [x] CLI exposes `fedai relays` plus docs for aggregator/trust overrides.
- [x] Automated Nostr relay discovery package added with normalization, trust scoring, and directory fetching utilities.
- [x] Manifests embed relay discovery snapshots and the CLI manifest flow now harvests them via discovery directories.
- [x] Router tracks reliability penalties and cooldown backoff after repeated node failures.
- [x] Router manifest promotion requires relay discovery snapshots when configured.
- [x] Router decays manifest trust as performance samples accumulate and applies a bounded performance bonus.
- [x] Router federation protocol message types and validators added to `packages/protocol`.
- [x] Router federation implementation: control-plane message ingestion + signing, data-plane stubs, and tests.
- [x] Phase 5 exit criteria met (graceful degradation + explicit accounting failure visibility).
- [x] Added operator runbooks for router, node, and CLI usage.
- [x] CLI ergonomics: added `--out` support for quote/infer and documented usage.
- [x] Observability checklist documented for router and node metrics/alerts.
- [x] Added Prometheus + Grafana local stack wiring in docker compose.
- [x] Added a starter Grafana dashboard for router/node metrics.
- [x] Added starter Prometheus alert rules for router/node error conditions.
- [x] Added a local OpenTelemetry collector config for trace ingestion.
- [x] Router federation spec documented in `docs/router-federation-v0.1.md`.
- [x] Router federation control-plane scaffolding (config/state/endpoints) added with tests.
- [x] Router federation data-plane stubs and receipt verification added with tests.
- [x] Federation metrics and dashboard panels added for control/data-plane activity.
- [x] Federation alert rules added to Prometheus starter alerts.
- [x] Self-publishing federation endpoints added for signed caps/price/status messages.
- [x] Simulator now supports end-to-end scenarios (routers, federation, payments).
- [x] Federation outbound publishing to peers added with tests.
- [x] Federation peer discovery (bootstrap + config peers) added with tests.
- [x] Federation auction loop stubbed with RFB responses and test coverage.
- [x] Federation award acceptance checks and outbound award helper added with tests.
- [x] Federation receipt-based payment request endpoint added with tests.
- [x] Award selection helper added for choosing winners from bids.
- [x] Federation payment receipt acceptance endpoint added with tests.
- [x] Auction orchestration helper (RFB → BID → AWARD) added with tests.
- [x] Federation job settlement tracking added (requests + receipts).
- [x] Deployment runbook added for non-local environments.
- [x] File-backed replay nonce store added for router/node (configurable via env).
- [x] Core mock runner removed from production code; retained only in tests.
- [x] TLS/mTLS config hooks added for router/node HTTP servers.
- [x] Default redacted logging utilities wired into router/node.
- [x] Lightning verification hook added for router/node payment receipt acceptance.
- [x] Scheduler now accounts for capability latency estimates and job type compatibility.
- [x] Security Hardening:
  - [x] Implemented SSRF protection in Router by blocking private IP ranges in node registration.
  - [x] Enhanced logging redaction using regex to capture dynamic secret keys (e.g., OpenAI API keys).
  - [x] Added startup warnings for ephemeral/in-memory nonce stores to prevent accidental replay vulnerability.
- [x] CLI & Operator Experience:
  - [x] Integrated hardware detection (CPU/RAM/GPU) into the CLI setup wizard.
  - [x] Integrated Hugging Face (GGUF) search and automatic download into the CLI.
  - [x] Updated setup wizard to guide operators through security and payment configuration.
- [x] Admin & Management:
  - [x] Implemented unified Admin API for Node and Router services.
  - [x] Implemented NIP-98 (Nostr-based HTTP Auth) for secure administrative access.
  - [x] Built a standalone Admin Dashboard supporting NIP-07 (browser extensions) and NIP-46 (remote signers via QR).
  - [x] Added web-based 'First Run' setup wizard for claiming and configuring services without CLI access.
- [x] Payments & Integration:
  - [x] Implemented NWC (Nostr Wallet Connect / NIP-47) support in the Lightning adapter.
  - [x] Added NWC configuration to the CLI setup wizard, enabling 'One-Click' payments.
- [x] Nostr identity alignment
  - [x] Add NIP-19 (npub/nsec) parsing + encoding in `@fed-ai/protocol`.
  - [x] Update CLI `gen-keys` to output npub/nsec and accept NIP-19 inputs.
  - [x] Enforce/validate Nostr identities for router/node IDs and envelopes.
- [ ] Nostr event layer
  - [x] Define NIP + event kinds for `CAPS_ANNOUNCE`, `PRICE_ANNOUNCE`, `STATUS_ANNOUNCE`, `RFB`, `BID`, `AWARD`.
  - [x] Implement relay publish/subscribe path for federation control-plane messages.
  - [x] Add tests for event signing/verification and relay publish flow.
- [ ] Nostr relay operations
  - [x] Add relay connection manager with retry/backoff and configurable relay lists.
  - [x] Verify inbound events against router/node allowlists and expiry windows.
  - [x] Add metrics for relay publish/subscribe failures.
  - [x] Enforce Nostr allowlists for federation peers and control-plane endpoints.
  - [x] Add follow/mute/block lists for Nostr federation peers and router ingress checks.
  - [x] Add rate limiting/budgets for inbound federation RFB/BID/AWARD events.
  - [x] Add Nostr event content size bounds before JSON parsing.
  - [x] Document relay allowlist and access controls in runbooks.
- [ ] Docs update
  - [x] Document required NIPs, identity format (NIP-19), and relay usage.
  - [x] Update protocol/architecture docs with event kind mapping and tag definitions.

## Scratchpad

- Open items, questions, and temporary notes go here.
