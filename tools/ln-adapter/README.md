# Lightning Adapter

HTTP adapter that bridges fed_AI routers/nodes to Lightning backends for invoice creation
and settlement verification.

Endpoints
- `POST /invoice` → `{ invoice, paymentHash?, expiresAtMs? }`
- `POST /verify` → `{ paid: boolean, settledAtMs?, detail? }`
- `GET /health` → `{ ok: true, backend }`

Environment
- `LN_ADAPTER_BACKEND`: `lnbits` or `lnd`
- `LN_ADAPTER_PORT`: listen port (default `4000`)
- `LN_ADAPTER_TIMEOUT_MS`: optional request timeout in ms

LNbits
- `LNBITS_URL`: base URL (e.g. `https://lnbits.example.com`)
- `LNBITS_API_KEY`: admin or invoice key with create/check permissions

LND REST
- `LND_REST_URL`: base URL (e.g. `https://lnd.example.com:8080`)
- `LND_MACAROON_HEX`: hex-encoded admin or invoice macaroon

Notes
- For LND, `paymentHash` is expected to be base64. Hex inputs are auto-converted.
- The adapter does not store invoices; it delegates to the backend.
