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
- Attestation (optional in v0.1)

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

- `PaymentRequest` carries Lightning invoice details for settlement.
- `PaymentReceipt` confirms settlement for a request and node.

## Replay protection

- Nonce tracking
- Timestamp window enforcement

## Validation

- Runtime validators for every public type
- Invalid envelopes rejected before business logic
