# fed_AI Router Federation Spec v0.1

## Router-to-Router Load Offload and Auctioning

### 1. Intent

Enable routers to cooperatively offload work to peer routers when overloaded, using a lightweight market mechanism (auction or posted pricing) that is:

- fast enough for interactive workloads
- safe by default (privacy levels, minimal context transfer)
- economically coherent (PAYG via Lightning, optional bonds)
- resilient (prevents thrash, avoids cascading failure)
- interoperable (standard message envelopes and receipts)

### 2. Goals

- Allow any router to discover peers, request capacity, and award work in seconds.
- Support multiple offload unit types (tool calls, embeddings, summarisation, generation chunks).
- Provide predictable pricing and optional bidding.
- Provide verifiable completion receipts and basic reputation signals.
- Support explicit privacy levels so operators can choose risk posture.
- Work over low-spec nodes and unstable networks.

### 3. Non-goals

- Solving Sybil resistance globally (can be layered later).
- Enforcing governance, fairness, or identity beyond signatures and local policy.
- Guaranteeing secrecy without end-to-end encryption and operator trust (privacy is explicit, not assumed).
- Mandating a single discovery or transport mechanism (spec defines interfaces).

### 4. Terms

- Router: a node that accepts client requests and routes work to local or remote executors.
- Peer Router: another router eligible to receive offloaded work.
- Job: a unit of work eligible for remote execution.
- RFB: request-for-bids (reverse auction).
- Price Sheet: signed posted prices for job types.
- Receipt: signed proof of job completion, used for settlement and reputation.
- Privacy Level (PL): explicit handling rules for data shared with peers.

### 5. High-level architecture

Routers run three logical planes:

1. Control Plane (Discovery + Negotiation): advertise capabilities and price, negotiate awards, publish status and backpressure.
2. Data Plane (Job Transfer): encrypted transport of job payload and result payload.
3. Settlement Plane (Payments + Accounting): Lightning payments, usage metering, receipts, optional bonds.

Discovery and negotiation can be implemented via:

- Nostr events (recommended for decentralized discovery) plus direct transport for payloads, or
- a direct gossip overlay, or
- a hybrid.

### 6. Offload eligibility and job types

Routers MUST classify work into job types with clear payload constraints.

Recommended initial job types:

- `EMBEDDING` (text -> vector)
- `RERANK` (query + candidates -> ranked list)
- `CLASSIFY` (labels)
- `MODERATE` (policy decision)
- `TOOL_CALL` (web fetch, code execution, structured tool)
- `SUMMARISE` (text -> summary)
- `GEN_CHUNK` (limited generation chunk, typically 256-2048 tokens)

Routers SHOULD avoid offloading:

- full multi-turn sessions unless PL and policy allow it
- long-context prompts unless the user explicitly opted in or PL allows it

### 7. Privacy levels

Routers MUST declare and enforce Privacy Levels per job.

- PL0 Public/Redacted:
  No user-identifying data. Payload is safe to disclose publicly.
  Examples: hashing, non-sensitive batch work, synthetic tests.
- PL1 Minimised Content:
  Some user content allowed, but stripped of identifiers and trimmed to minimum required context.
  Payload encrypted in transit. No long-term storage allowed by receiver (policy-level requirement).
- PL2 Encrypted Full Payload:
  Full content allowed; end-to-end encryption required. Receiver must support "no retention" mode and provide signed receipts. Suitable for trusted peers.
- PL3 Local Only:
  Never offload. Router must reject offload attempts for this job.

Routers MUST expose a policy setting that maps user requests and job types to an allowed maximum PL.

### 8. Capability model

Each router MUST publish a signed Capability Profile:

- `router_id` (public key identifier)
- `transport_endpoints` (one or more)
- `supported_job_types`
- `resource_limits` (max payload bytes, max tokens, max concurrency)
- `model_caps` (model IDs, context sizes, tool availability)
- `privacy_caps` (max PL supported)
- `settlement_caps` (Lightning methods supported, currency)
- `attestation` (optional: build hash, operator policy statement)
- `timestamp`, `expiry`

Routers SHOULD include a short rolling "load summary":

- `queue_depth`, `p95_latency_ms`, `cpu_pct`, `ram_pct`, `active_jobs`
- `backpressure_state` (NORMAL, BUSY, SATURATED)

### 9. Pricing

Two pricing modes are supported.

#### 9.1 Posted Price (required)

Routers MUST support publishing a signed Price Sheet.

Price Sheet fields:

- `router_id`
- `job_type`
- `unit` (PER_JOB | PER_1K_TOKENS | PER_MB | PER_SECOND)
- `base_price_msat`
- `surge_model` (simple multiplier)
- `current_surge` (float or fixed-point)
- `sla_targets` (max_queue_ms, expected_runtime_ms)
- `timestamp`, `expiry`

Surge recommendation (simple, deterministic):

```
surge = clamp(1.0, 5.0, 1.0 + (queue_depth / Q) + (p95_latency / L))
```

Where `Q` and `L` are operator-configured thresholds.

#### 9.2 Reverse Auction (optional but recommended)

Routers MAY run an auction for time-sensitive jobs.

Auction has three messages:

- `RFB` (request-for-bids)
- `BID`
- `AWARD`

Auctions MUST complete within a short TTL (e.g., 250-1500 ms for interactive jobs, 2-5 s for batch).

### 10. Control-plane messages

All control-plane messages MUST be:

- signed by sender
- include `timestamp` and `expiry`
- include a `message_id` (unique)
- optionally reference a `prev_message_id` for threading

#### 10.1 Message envelope (common)

- `type`
- `version`
- `router_id`
- `message_id`
- `timestamp`
- `expiry`
- `payload`
- `sig`

#### 10.2 Types

- `CAPS_ANNOUNCE`
- `PRICE_ANNOUNCE`
- `STATUS_ANNOUNCE`
- `RFB`
- `BID`
- `AWARD`
- `CANCEL`
- `RECEIPT_SUMMARY` (optional public receipt hash announcements)

### 11. Auction payloads

#### 11.1 RFB payload

- `job_id`
- `job_type`
- `privacy_level`
- `size_estimate` (tokens, bytes, items)
- `deadline_ms`
- `max_price_msat`
- `required_caps` (e.g., model ID, tools)
- `validation_mode` (NONE | HASH_ONLY | REDUNDANT_N | DETERMINISTIC_CHECK)
- `transport_hint` (preferred endpoint type)
- `payload_descriptor` (no sensitive content, just shape)
- `job_hash` (hash of canonical job descriptor to bind later)

#### 11.2 BID payload

- `job_id`
- `price_msat`
- `eta_ms`
- `capacity_token` (a short-lived commitment to reserve capacity)
- `constraints` (max runtime, max tokens)
- `bid_hash` (binds bid terms)

#### 11.3 AWARD payload

- `job_id`
- `winner_router_id`
- `accepted_price_msat`
- `award_expiry`
- `data_plane_session` (key agreement parameters or session URL)
- `payment_terms` (prepay/postpay, max cap)
- `award_hash`

### 12. Data-plane transport

Routers MUST support at least one encrypted transport. Options:

- QUIC/TLS
- HTTPS with mTLS
- Nostr DM is allowed for tiny payloads only (control-plane, not results)

Data plane MUST provide:

- encryption in transit
- message authentication
- replay protection
- payload size enforcement

Implementation note (v0.1):
- The reference implementation wraps `JOB_SUBMIT` and `JOB_RESULT` in the standard `Envelope<T>` and verifies signatures + replay windows before processing.

Job transfer has two messages:

- `JOB_SUBMIT`
- `JOB_RESULT`

#### 12.1 JOB_SUBMIT fields

- `job_id`
- `job_type`
- `privacy_level`
- `payload` (encrypted if PL1+)
- `context_minimisation` metadata (what was removed, optional)
- `input_hash` (hash of decrypted canonical payload, computed by sender)
- `max_cost_msat`
- `max_runtime_ms`
- `return_endpoint`

#### 12.2 JOB_RESULT fields

- `job_id`
- `result_payload`
- `output_hash`
- `usage` (tokens, runtime, bytes)
- `result_status` (OK | PARTIAL | FAIL)
- `error_code` (if any)
- `receipt` (signed, see below)

### 13. Receipts and verification

Routers MUST produce a signed receipt for any completed job (including failures).

Receipt fields:

- `job_id`
- `request_router_id`
- `worker_router_id`
- `input_hash`
- `output_hash`
- `usage`
- `price_msat`
- `status`
- `started_at`, `finished_at`
- `receipt_id`
- `sig`

Verification modes:

- HASH_ONLY: validate receipt binding to the submitted payload hash.
- DETERMINISTIC_CHECK: for tasks with deterministic outcomes (or bounded variation).
- REDUNDANT_N: send to N peers and compare outputs; use majority or confidence score.

Routers SHOULD default to REDUNDANT_N for low-cost, high-risk tasks (moderation/classification) when peer trust is unknown.

### 14. Settlement (Lightning)

Routers MUST support PAYG settlement with at least one of:

- invoice-based payments (worker provides invoice)
- LNURL-pay flows
- keysend (if both support)

Payment terms:

- Postpay (default): pay on valid receipt.
- Prepay (optional): small capped prepayment for unknown peers or high-demand times.
- Escrow (future): hold invoice or conditional release based on verification.

Routers MUST enforce:

- `max_cost_msat` caps per job
- rate limits per peer
- refusal when caps cannot be met

### 15. Reputation and trust

Minimum reputation signals:

- rolling success rate
- rolling median/95p latency
- dispute rate
- cancellation rate
- receipt validity rate

Routers MAY publish signed reputation summaries, but local policy MUST decide whether to trust them.

Optional bonding:

- router locks a bond (sats) to signal seriousness
- slashing is only possible with a provable dispute mechanism (future extension)
- in v0.1, bonding is informational, not enforceable

### 16. Backpressure and anti-thrash rules

Routers MUST implement:

- Admission control: stop accepting new work when above saturation thresholds.
- Backpressure broadcast: publish `STATUS_ANNOUNCE` with BUSY or SATURATED.
- Cooldown: do not re-auction the same job within a cooldown window (e.g., 2-10s).
- Retry budget: max attempts per job (e.g., 2-3).
- Circuit breaker: temporarily block peers with repeated failures.

Routing selection SHOULD prefer:

- peers with low latency and good reputation
- diversity across operators to avoid correlated failure
- stable endpoints over flapping endpoints

### 17. State machines (minimum)

#### 17.1 Requesting router

- `LOCAL_RUN` or `OFFLOAD_ELIGIBLE`
- if overloaded -> `SEEK_PEERS`
- choose pricing mode:
  - posted price -> `SELECT_PEER`
  - auction -> `RFB_OPEN` -> `AWARD_SENT`
- `JOB_SUBMITTED`
- `RESULT_RECEIVED` -> `VERIFY`
- `SETTLE` -> `DONE`
- on failure -> `RETRY` (budget) else `LOCAL_FALLBACK` or `FAIL`

#### 17.2 Worker router

- `IDLE` -> `BID` (optional) -> `RESERVED`
- `JOB_ACCEPTED` -> `RUN`
- `RETURN_RESULT` -> `ISSUE_RECEIPT`
- `DONE`

### 18. Policy knobs (operator configuration)

Each router SHOULD expose:

- max concurrent offloads
- max spend per minute/hour/day
- allowed PL per job type
- allowlist/denylist peers
- minimum reputation threshold
- redundancy defaults per job type
- surge parameters and price floors
- transport preferences (onion/IPv6/IPv4 ordering if relevant)

### 19. Interop profile

To claim compliance with "Router Federation v0.1", an implementation MUST:

- publish signed capability and price announcements
- support posted price routing
- support at least one encrypted data-plane transport
- use job envelopes, caps, receipts, and basic verification
- enforce privacy levels and spending caps
- implement backpressure announcements

Reverse auction support is RECOMMENDED but not required for v0.1 compliance.

### 20. Suggested mapping to your existing ecosystem

If you use Nostr for discovery/negotiation:

- `CAPS_ANNOUNCE`, `PRICE_ANNOUNCE`, `STATUS_ANNOUNCE` map cleanly to replaceable, signed events.
- `RFB/BID/AWARD` can be ephemeral events or encrypted DMs depending on privacy.
- Payloads and results should go direct (QUIC/HTTPS), not via relays, except tiny jobs.

### 21. Security notes (v0.1 reality check)

- PL2 implies you trust the peer not to retain data. Crypto protects transit, not operator behavior.
- Receipts prove "something was returned", not correctness. Use redundancy or deterministic checks for higher assurance.
- Without Sybil resistance, reputation can be gamed. Use allowlists, local scoring, and spend caps early.

### 22. Appendices

#### A. Canonical hashing

All hashes MUST be computed over a canonical serialization of the relevant object (stable key ordering, UTF-8, normalized whitespace rules per job type). This binds receipts and prevents ambiguity.

#### B. Error codes (starter set)

- `ERR_TIMEOUT`
- `ERR_CAPS_MISMATCH`
- `ERR_TOO_LARGE`
- `ERR_PRIVACY_UNSUPPORTED`
- `ERR_OVER_CAP`
- `ERR_INTERNAL`
- `ERR_CANCELLED`
