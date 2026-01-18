# Architecture

## Planes

Control plane
- Router service (decision engine)
- Node service (orchestrator)
- Protocol package (shared types and validation)
- SDK/CLI/simulator

Compute plane
- External model runners (hot-swappable)

## Decentralization and Nostr alignment

- Node identities are Nostr identities (Ed25519 with NIP-19 npub/nsec encoding).
- Control-plane messages are signed and can be relayed over Nostr without payload leakage.
- Discovery and reputation can be relay-backed while keeping prompts and outputs off relays.
- Nostr relays are used for discovery and trust signaling; operational traffic is peer-to-peer between client, router, and node (direct HTTP).
- Relay discovery uses the `@fed-ai/nostr-relay-discovery` package to fetch, normalise, score, and deduplicate aggregator directories, so routers and installers always have a fresh candidate set while keeping discovery logic decoupled from core services.
- Router federation control-plane messages map to dedicated Nostr kinds (20020-20023 for ephemeral auctions, 30020-30023 for replaceable announcements).
- Routers can enforce allowlists, follow/mute/block preferences, and WoT scoring to filter inbound relay traffic.
- Relay connections use retry/backoff to avoid flapping relays and reduce noisy reconnect loops.

## Federation model

- Nodes are operated by independent parties.
- Nodes advertise models, capacity, pricing hints, and region.
- Nodes heartbeat to the router; no implicit trust is assumed.
- Architecture supports gradual evolution toward peer-to-peer discovery.

## Payments and settlement

- Metering records support Lightning-aligned settlement without centralized custody.
- Settlement details are layered above the protocol to preserve control-plane stability.

## Capability Profiler and Role Recommendation System

### Goal

Add a first-run Capability Profiler that:

1. inspects hardware, OS, and network
2. optionally runs short deterministic benchmarks
3. recommends safe setup types (node profiles and router eligibility)
4. generates a signed capabilities manifest used for initial routing weights and policy

This must apply to both nodes and routers, with stricter rules for routers.

---

## 1. New components

### 1.1 profiler (shared library)

Responsibility: collect system facts and benchmark results in a normalised format.

Outputs:

- HardwareProfile
- NetworkProfile
- BenchmarkProfile
- CapabilityBands (coarse classes)

#### Data to collect (Linux-first, extendable)

- CPU: arch, core/thread counts, frequency, feature flags (AVX/AVX2/AVX-512)
- RAM: total, available
- Disk: SSD/HDD, free space, optional simple IOPS sample
- GPU: vendor, VRAM, runtime availability (CUDA/ROCm), optional inference smoke test
- Network: upload/download, latency to configured router targets, jitter estimate
- OS: distro, kernel, container runtime presence (optional)

Privacy constraint: do not persist or publish unique identifiers (serials, MAC, exact model strings) unless operator explicitly opts in.

---

### 1.2 bench (optional but recommended for nodes, mandatory for routers)

Responsibility: run short, deterministic tests and produce comparable scores.

Keep total runtime:

- Nodes: 1 to 3 minutes default, 5 minutes max optional
- Routers: mandatory suite, 2 to 5 minutes

Benchmarks:

- CPU microbench: small matrix multiply or integer/float loop
- Memory bandwidth: memcpy loop
- Disk sample: small sequential write/read and random read sample
- Network: latency to router and 1–2 public targets, short throughput test
- GPU optional: tiny inference/smoke test only if runtime present

All benchmarks should be seedable/deterministic and produce stable-ish scores.

---

### 1.3 recommender

Responsibility: map profiles into recommended roles and safe defaults.

Inputs:

- Profiles from profiler and bench
- Operator intent flags (optional): low power, high earnings, privacy, reliability

Outputs:

- List of recommended node profiles with rationale and estimated constraints
- Router eligibility verdict: PASS | FAIL with reasons
- Suggested defaults: concurrency, max payload size, token limits, pricing baseline

---

### 1.4 manifest

Responsibility: generate and sign a manifest for nodes and routers.

Files:

- node.manifest.json (for nodes)
- router.manifest.json (for routers)

Signing:

- Use the node/router identity key to sign the manifest content.
- Store signature adjacent: *.sig or embed signature field.

---

## 2. Capability bands (coarse classes)

Convert raw specs into bands to avoid leaking identifiable detail and to simplify routing.

Example bands:

- cpu_low | cpu_mid | cpu_high
- ram_8 | ram_16 | ram_32 | ram_64_plus
- disk_hdd | disk_ssd
- net_poor | net_ok | net_good
- gpu_none | gpu_8gb | gpu_16gb | gpu_24gb_plus

These bands are what the router uses for initial filtering and weights.

---

## 3. Node profiles to recommend (low-spec friendly emphasis)

### Low-spec strong fits

- prepost_node: sanitise, chunking, schema validation, output formatting
- policy_node: rate limits, simple abuse heuristics, allow/deny policy evaluation
- cache_node: semantic cache lookup, TTL store, fingerprinting, dedupe
- embedding_node_small: small embedding model, CPU oriented
- rerank_node_tiny: lightweight scoring/rerank where feasible
- registry_helper_node: announcements, health, attestations publishing, NAT/bridge helper

### Higher-spec options (only when justified)

- llm_cpu_small: small quantised LLM inference (tight bounds)
- llm_gpu: GPU inference role, sized by VRAM and observed perf

Node recommendation rules must include both:

- Hard gates (eg RAM too low means no LLM)
- Soft scoring (eg throttling or poor network lowers concurrency defaults)

---

## 4. Router profiling and recommendations (stricter)

### Router is never auto-recommended

The system may only say:

- “This machine is capable of running a router” or
- “This machine should not run a router”

### Router minimums (hard fail conditions)

Set defaults conservatively, configurable via project config:

- CPU: x86_64 with AVX2 minimum
- RAM: >= 16 GB (32 GB preferred)
- Disk: SSD required
- Network: stable, low jitter, acceptable upload
- Benchmarks: mandatory and must pass thresholds
- Mixed-mode: router should not be co-hosted with heavy inference by default

### Router benchmark focus

- Concurrent request handling
- Routing decision latency under load
- Memory pressure behaviour
- Network fan-out performance
- Retry and failover handling
- Logging/audit overhead

### Router install mode: probation

If eligible, default router to probation mode:

- low routing weight
- strict rate limits
- aggressive health checks
- promotion only after observed stability (router’s own metrics plus peer observation if implemented)

---

## 5. Manifest schema requirements

### Node manifest fields (minimum)

- id (node identity pubkey or node id)
- role_types (enabled node profiles)
- capability_bands
- limits: max_concurrency, max_payload_bytes, max_tokens
- supported_formats (text/json/etc)
- pricing_defaults (per-call or per-token baseline)
- benchmarks: scores + timestamp
- software_version
- signature
- relay_discovery (optional snapshot of the relays consulted during manifest creation)

### Router manifest fields (minimum)

- id
- router_mode: probation | normal
- capability_bands
- limits: max_qps, max_concurrent_jobs, max_payload_bytes
- policies_enabled (rate limit, allowlists, etc)
- audit_mode (on/off, level)
- benchmarks: routing latency under load + timestamp
- software_version
- signature
- relay_discovery (optional snapshot of the relays consulted during manifest creation)

Privacy: manifests should avoid unique hardware identifiers unless opt-in.

The optional `relay_discovery` block records:

- `discoveredAtMs`: when the snapshot was captured.
- `relays`: normalized `RelayDescriptor`s (url, read/write flags, score, latency hint).
- `options`: bootstrap relays, aggregator URLs, trust-score overrides, and min/max filters used for discovery.

---

## 6. Router usage of manifest

Routers should:

- Accept manifests for initial admission and weighting
- Require valid relay discovery snapshots before using manifest trust for promotion when configured
- Replace manifest trust with observed performance over time (decay manifest weight as samples accumulate)
- Downgrade or quarantine nodes that consistently underperform vs claims

---

## 7. UX and CLI requirements

## Router federation (spec v0.1)

Router-to-router offload, pricing, privacy levels, receipts, and backpressure are defined in
`docs/router-federation-v0.1.md`.

### First-run wizard (both node and router installers)

Steps:

1. Scan hardware
2. Run quick benchmark (required for router, recommended for nodes)
3. Show recommended roles and defaults
4. “One click apply” for recommended profile(s)
5. Advanced override

### CLI

Provide commands:

- fedai profile (hardware + network scan)
- fedai bench (run suite)
- fedai recommend (produce recommended profiles)
- fedai manifest --write (generate and sign manifests)
- fedai manifest can optionally consult discovery directories (`--bootstrap`, `--aggregators`, `--trust-scores`, `--min-score`, `--max-results`) and include the snapshot unless `--skip-relays` is supplied.
- fedai setup node / fedai setup router (guided flow)

All commands must be scriptable and non-interactive via flags.

---

## 8. Config knobs (project spec)

Add config entries for:

- Router minimum thresholds
- Node recommendation thresholds
- Benchmark runtime limits
- Privacy mode: strict | normal | verbose
- Default profiles enabled per capability band

---

## 9. Acceptance criteria

- Running fedai setup node on low-spec hardware recommends at least one useful profile (pre/post, policy, cache, registry helper) with safe defaults.
- Running fedai setup router on insufficient hardware hard-fails with clear reasons.
- Router setup always runs benchmarks and writes a signed router.manifest.json.
- Node setup can skip benchmarks, but if skipped, defaults are extra conservative and manifest notes benchmarks: null.
- Manifests are signed and verifiable.
- No unique hardware identifiers are collected or published unless opt-in.
- Router can ingest manifests and use capability bands for initial routing decisions.

---

## 10. Implementation notes (keep it simple)

- Linux-first implementation, design interfaces so Windows/macOS can be added later.
- Prefer capability bands over exact specs for routing.
- Deterministic, short benchmarks over complex, flaky ones.
- Conservative defaults that prioritise stability and predictability over peak performance.

## Trust & Resilience

- The router tracks repeated node failures and reduces their trust score, with consecutive failures triggering cooldown backoff to protect request latency.
- Nodes that return invalid responses or fail to sign telemetry are temporarily quarantined for a cooldown window before being reconsidered.
- The router retries alternative nodes on inference failure when payments are not locked to a specific node.
- Metrics capture node failure counts, cooldowns, and accounting verification failures so operators can audit and improve stability over time.

## Staking and Bonding Model

### Purpose

Introduce a staking system that improves trust, routing quality, and network resilience without turning fed_AI into a financial product.

Staking in fed_AI is a bond against bad behaviour, not yield, governance power, or speculation.

---

## 1. Design principles

Staking MUST:

- Increase economic friction for bad actors
- Reduce attack surface for routers
- Influence routing weights, not binary access
- Be deterministic and rule-based
- Avoid speculative or yield-based mechanics

Staking MUST NOT:

- Grant voting rights by default
- Replace observed performance
- Create plutocracy
- Require a native token in early phases

---

## 2. Who can stake

### 2.1 Node operators

Nodes MAY stake to:

- Increase routing priority
- Unlock higher concurrency limits
- Reduce probation duration
- Advertise stronger reliability guarantees

Zero-stake nodes are allowed, but routed conservatively.

---

### 2.2 Router operators

Routers MUST stake to:

- Be admitted as routable routers
- Increase routing influence
- Shorten probation period
- Act as policy and enforcement actors

Router staking thresholds are significantly higher than node thresholds.

---

### 2.3 Clients (optional, future)

Clients MAY stake to:

- Reserve capacity
- Avoid throttling during congestion
- Guarantee latency or throughput classes

Client staking is explicitly optional and non-blocking.

---

## 3. What is staked

Early phases use abstract stake units, not a live token.

Acceptable stake representations:

- Internal stake credits
- Time-locked commitments
- Bonded reputation units earned via work
- Later mapping to external assets (eg Lightning escrow)

The staking interface MUST be abstract enough to support multiple backends later.

---

## 4. Where stake lives

Stake MUST NOT be held by a single central authority.

Allowed models:

- Router-scoped escrow
- Time-bound stake commitments
- Multi-router observation with delayed release
- Revocable stake credits

Rules:

- Routers do not custody long-term user funds
- All stake actions are logged and auditable
- Stake has explicit expiry or decay

---

## 5. How staking affects routing

Staking influences routing weights only, never hard access.

Example routing weight formula (illustrative):

```
effective_weight =
  performance_score
× uptime_score
× reliability_score
× stake_factor
```

Constraints:

- stake_factor is capped
- Performance always dominates stake
- Stake cannot compensate for repeated failures

---

## 6. Probation and promotion flow

### New nodes and routers

- Start in probation mode
- Low or zero stake permitted
- Strict rate and concurrency limits

### Promotion inputs

- Observed job success
- Uptime over time
- Reliability under load
- Small or moderate stake commitment
- Time-in-network

Stake accelerates promotion but never replaces observation.

---

## 7. Slashing rules

Slashing MUST be boring, explicit, and deterministic.

### Slashable events

- Cryptographic misrepresentation
- Repeated job acceptance followed by failure
- Proven output tampering
- Explicit policy violations
- Refusing accepted jobs without cause

### Non-slashable events

- Low quality output
- Slow responses within declared limits
- Unpopular or undesired outputs

Slashing properties:

- Partial and proportional
- Logged and reviewable
- Never total unless explicitly configured
- Deterministic based on evidence

---

## 8. Stake decay and expiry

All stake MUST:

- Expire
- Or decay over time
- Or be consumed by usage

Supported decay models:

- Linear time decay
- Inactivity-triggered reduction
- Usage-based consumption

This prevents dead capital and permanent dominance.

---

## 9. Governance boundaries

Staking DOES NOT automatically grant:

- Votes
- Protocol control
- Rule changes

Staking MAY unlock:

- Proposal submission
- Experimental routing participation
- Policy module testing

Core protocol rules remain code-defined.

---

## 10. Minimal Viable Staking (MVS)

Initial implementation MUST include:

- Abstract stake units
- Router-managed escrow logic
- Deterministic slashing rules
- Stake-influenced routing weights
- Probation and promotion flow

Initial implementation MUST NOT include:

- Token issuance
- Yield or rewards
- On-chain dependencies

---

## 11. Required spec additions

Add a new section titled:

Staking and Bonding Model

Include:

- Definitions of stake units
- Stake lifecycle (commit, decay, release)
- Routing weight integration
- Slashing conditions
- Probation and promotion rules
- Router vs node differences

---

## 12. Acceptance criteria

- Nodes can operate with zero stake.
- Routers require stake to exit probation.
- Stake increases priority but cannot override poor performance.
- Slashing is deterministic and auditable.
- Stake expires or decays automatically.
- No yield, rewards, or speculative mechanics exist in the spec.

---

### One-line summary for the spec

> Staking in fed_AI is a bounded economic bond that discourages bad behaviour and smooths routing decisions without granting power, yield, or control.

## Data flow (high level)

1. Node advertises capabilities and pricing to the router.
2. Client requests a quote via router.
3. Router selects nodes and dispatches a signed inference request.
4. Node runs the request via its runner.
5. Node returns inference response and signed metering record.
6. Router verifies and aggregates metering.

## Key properties

- All payloads are signed envelopes.
- Replay protection enforced for every request.
- Prompts and outputs are not logged.
