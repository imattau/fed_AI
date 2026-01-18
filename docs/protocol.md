# Protocol

All services use the canonical protocol package in `packages/protocol`.
No service defines its own protocol types or accepts unsigned payloads.

## Envelope

```
Envelope<T> {
  payload: T
  nonce: string
  ts: number
  keyId: string
  sig: string
}
```

## Core types

- NodeDescriptor
- Capability
- ModelInfo
- QuoteRequest
- QuoteResponse
- PaymentRequest
- PaymentReceipt
- InferenceRequest
- InferenceResponse
- MeteringRecord
- ProtocolError
- StakeCommit
- StakeSlash
- Attestation (optional in v0.1)
- NodeOffloadRequest
- NodeRfbPayload
- NodeBidPayload
- NodeAwardPayload
- Router federation:
  - RouterControlMessage
  - RouterCapabilityProfile
  - RouterPriceSheet
  - RouterStatusPayload
  - RouterRfbPayload
  - RouterBidPayload
  - RouterAwardPayload
  - RouterJobSubmit
  - RouterJobResult
  - RouterReceipt
  - RouterReceiptSummary

## Crypto

- secp256k1 Schnorr signatures
- `signEnvelope()` and `verifyEnvelope()`
- Keys are Nostr identities (secp256k1 with NIP-19 npub/nsec encoding)
- `keyId` is the Nostr public key (`npub...`)
- Services accept keys as npub/nsec or 32-byte hex

## Nostr event layer (router federation)

Required NIPs
- NIP-01 (basic event model, signatures)
- NIP-19 (npub/nsec encoding for identifiers)

Event kinds (v0.1)
- `30020` `CAPS_ANNOUNCE`
- `30021` `PRICE_ANNOUNCE`
- `30022` `STATUS_ANNOUNCE`
- `30023` `RECEIPT_SUMMARY`
- `20020` `RFB`
- `20021` `BID`
- `20022` `AWARD`
- `20023` `CANCEL`

Event tags
- `t`: message type (e.g. `RFB`)
- `v`: protocol version (e.g. `0.1`)
- `msg`: message id
- `exp`: expiry timestamp (ms since epoch)

Event payloads
- `content` is the JSON-encoded `RouterControlMessage.payload`.
- `pubkey` maps to the router identity; `routerId` is derived as `npub` from `pubkey`.

## Security posture

- All requests and responses use signed envelopes.
- Replay protection enforced via nonces and timestamp windows.
- Nodes sign metering records to support independent verification.

## Payments

- `PaymentRequest` carries Lightning invoice details for peer-to-peer settlement.
- `PaymentReceipt` confirms settlement for a request and payee.
- `PaymentRequest.splits` can encode split payees (e.g. router fee + node inference) when the invoice backend supports it.
- `PaymentReceipt.splits` echoes the split breakdown used for settlement verification.

Payment lifecycle
- Router coordinates payment requirements and returns invoice details (from nodes and optionally routers).
- Client pays Lightning invoices directly to the payees and returns a signed `PaymentReceipt` envelope.
- Router verifies payment proofs without custody and records settlement; node validates the receipt before executing inference when required.
- The receipt is forwarded as `InferenceRequest.paymentReceipts` for pay-before-work flows.

Scheduling hints
- `Capability.jobTypes` can advertise which job types a model supports (e.g. `CLASSIFY`, `EMBEDDING`).
- `Capability.latencyEstimateMs` can advertise expected latency for that capability.
- `InferenceRequest.jobType` and `QuoteRequest.jobType` allow routers to route by job type when provided.

## Replay protection

- Nonce tracking
- Timestamp window enforcement

## Validation

- Runtime validators for every public type
- Invalid envelopes rejected before business logic

## Router federation (v0.1)

Router-to-router offload, pricing, privacy levels, control-plane messages, and receipts are
specified in `docs/router-federation-v0.1.md`. Protocol types for federation messaging live
in `packages/protocol` and are the canonical source for validation and signing.
