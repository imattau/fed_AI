# Threat Model

## Goals
- Prevent request tampering.
- Prevent replay attacks.
- Ensure metering integrity.
- Avoid prompt/output leakage.

## Threats
- Forged inference requests
- Replay of signed envelopes
- Metering manipulation
- Node impersonation
- Runner escape or sandbox violations
- Relay metadata leakage or correlation

## Mitigations
- secp256k1 Schnorr signatures on all envelopes
- Nonce tracking and timestamp windows
- Signed metering records
- Key management and rotation
- Strict log redaction
- Keep prompts/outputs off relays; only publish minimal metadata

## Mitigations mapped to code

- Signed envelopes + key parsing: `packages/protocol/src/crypto.ts`, `packages/protocol/src/keys.ts`, `packages/protocol/src/envelope.ts`
- Replay protection + nonce storage: `packages/protocol/src/replay.ts`
- Validation gates at ingress: `services/router/src/http.ts`, `services/node/src/http.ts`
- AuthZ policy hooks: `services/router/src/authz.ts`, `services/node/src/authz.ts`
- Ingress rate limiting: `services/router/src/rate-limit.ts`, `services/node/src/rate-limit.ts`
- Signed metering + verification: `services/node/src/http.ts`, `services/router/src/http.ts`
- Log redaction + observability: `services/router/src/logging.ts`, `services/node/src/observability.ts`
