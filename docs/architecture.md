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

## Federation model

- Nodes are operated by independent parties.
- Nodes advertise models, capacity, pricing hints, and region.
- Nodes heartbeat to the router; no implicit trust is assumed.
- Architecture supports gradual evolution toward peer-to-peer discovery.

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
