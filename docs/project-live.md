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

- [x] First real runner adapter (HTTP-backed).
- [x] Plug the discovered relay list into manifest publication/advertisement flows to help routers/nodes publish to peers.

## Upcoming tasks

- [x] Expanded trust/resilience handling.
- [x] Add router admission checks that verify `relay_discovery` snapshots before promotion.
- [x] Draft Router Federation Spec v0.1 (router-to-router offload + auctioning, privacy levels, receipts, settlement, and backpressure rules).
- [x] Phase 6: operator runbooks + observability checklist + CLI ergonomics pass.

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

## Completed

- [x] Repository scaffolding and file layout created.
- [x] Initial docs drafted (`docs/*.md`) and runbooks scaffolded.
- [x] Workspace wiring and configs added.
- [x] Live project tracker created and referenced in `AGENTS.md`.
- [x] Protocol package core types, validators, crypto, replay utilities, and exports implemented.
- [x] Protocol package tests added with `node:test`.
- [x] Node and router scaffolds added (runner types, mock runner, scheduler skeleton).
- [x] Node and router services expose minimal HTTP servers with signed envelope validation.
- [x] Key parsing utilities added (PEM or 32-byte hex Ed25519).
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

## Scratchpad

- Open items, questions, and temporary notes go here.
