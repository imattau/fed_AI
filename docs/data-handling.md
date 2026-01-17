# Data Handling

- Prompts and outputs are never logged.
- Prompts are hashed for metering correlation.
- Only metadata required for routing is stored.
- Nostr relays must never carry prompt/output payloads.
- Logs are redacted by default to avoid accidental secret or payload exposure.
- Payment verification can be delegated to Lightning-aware backends via HTTP verification hooks; receipts are rejected when verification fails.

Retention
- Nonce data retained only within replay window and can be persisted via file-backed nonce stores.
- Metering records retained per policy.
