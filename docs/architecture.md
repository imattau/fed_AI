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

- Node identities are Ed25519 keys compatible with Nostr key formats.
- Control-plane messages are signed and can be relayed over Nostr without payload leakage.
- Discovery and reputation can be relay-backed while keeping prompts and outputs off relays.
- Nostr relays are used for discovery and trust signaling; operational traffic is peer-to-peer (direct router↔node HTTP).

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

Privacy: manifests should avoid unique hardware identifiers unless opt-in.

---

## 6. Router usage of manifest

Routers should:

- Accept manifests for initial admission and weighting
- Replace manifest trust with observed performance over time
- Downgrade or quarantine nodes that consistently underperform vs claims

---

## 7. UX and CLI requirements

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
