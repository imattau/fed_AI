# Data Handling

- Prompts and outputs are never logged.
- Prompts are hashed for metering correlation.
- Only metadata required for routing is stored.
- Nostr relays must never carry prompt/output payloads.

Retention
- Nonce data retained only within replay window.
- Metering records retained per policy.
