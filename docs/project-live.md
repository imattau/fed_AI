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
- Exit: graceful degradation and no silent accounting failures

Phase 6 - Operational readiness
- Runbooks, observability, CLI ergonomics, operator docs
- Exit: third-party can run a node with diagnosable behavior

Phase 7 - Optional extensions
- Streaming inference, peer discovery, reputation, settlement, chained nodes

## Active tasks

- [x] First real runner adapter (HTTP-backed).

## Upcoming tasks

- [ ] Observability hooks (metrics + tracing).
- [ ] Expanded trust/resilience handling.

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

## Scratchpad

- Open items, questions, and temporary notes go here.
