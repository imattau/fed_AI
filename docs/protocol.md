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

- Ed25519 signatures
- `signEnvelope()` and `verifyEnvelope()`
- Keys are compatible with Nostr Ed25519 key material
- `keyId` identifies the signing key and should map to a Nostr public key
- Services accept keys as PEM or 32-byte hex public keys

## Security posture

- All requests and responses use signed envelopes.
- Replay protection enforced via nonces and timestamp windows.
- Nodes sign metering records to support independent verification.

## Payments

- `PaymentRequest` carries Lightning invoice details for peer-to-peer settlement.
- `PaymentReceipt` confirms settlement for a request and payee.

Payment lifecycle
- Router coordinates payment requirements and returns invoice details (from nodes and optionally routers).
- Client pays Lightning invoices directly to the payees and returns a signed `PaymentReceipt` envelope.
- Router verifies payment proofs without custody and records settlement; node validates the receipt before executing inference when required.
- The receipt is forwarded as `InferenceRequest.paymentReceipt` for pay-before-work flows.

## Replay protection

- Nonce tracking
- Timestamp window enforcement

## Validation

- Runtime validators for every public type
- Invalid envelopes rejected before business logic

## Router federation (v0.1)

Router-to-router offload, pricing, privacy levels, control-plane messages, and receipts are
specified in `docs/router-federation-v0.1.md`. Protocol types for federation messaging will
consolidate into the canonical protocol package once implemented.
