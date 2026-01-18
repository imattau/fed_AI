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
