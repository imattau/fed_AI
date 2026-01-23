# Simple Chat Example

This example spins up a tiny web chat client, a router, three nodes (LLM + CPU-only + Groq), a Lightning adapter, Postgres for router/nonce storage, and a llama.cpp-backed tiny LLM inside Docker. It also exercises the Lightning payment flow using the SDK payment helpers.

## Prereqs

- Docker (for the llama.cpp server)
- Node.js LTS + pnpm

## 1) Tiny GGUF model

The compose stack auto-downloads a TinyLlama Q2_K GGUF on first run into `examples/simple-chat/models/`.
If you want a different model, edit `MODEL_URL` in `examples/simple-chat/docker-compose.yml` and keep the output filename `tinyllama.gguf` (or adjust the compose path accordingly).

## 2) Start everything with Docker Compose

```bash
cd examples/simple-chat
docker compose up --build
```

If the llama.cpp image tag changes, set `LLAMA_CPP_TAG` (default is `server` from `ghcr.io/ggml-org/llama.cpp`):

```bash
LLAMA_CPP_TAG=full-<tag> docker compose up --build
```

If you update the model file, remove the `keys` volume to regenerate keys:

```bash
docker compose down -v
```

Open `http://localhost:3000` and send a prompt.
The router will auto-select between the LLM node and the CPU-only node.
Select "Groq (llama-3.1-8b-instant)" to route via the Groq node and enter a Groq API key in the modal prompt (session-only).
Use the Router and Node tabs to view a lightweight status dashboard.
The Router tab also shows federation/Nostr settings and relay backoff configured by the compose stack.

Ports:
- Router: `http://localhost:18080`
- Runner (llama.cpp): `http://localhost:18085`
- Lightning adapter: `http://localhost:4000`
- Postgres: internal only (`postgres:5432`)

## Architecture

The example demonstrates a modular architecture where the **Node Service** (business logic, payments, protocol handling) is separated from the **Inference Runner** (heavy compute).

- **Node (`node-llm`)**: TypeScript service that implements the `fed_AI` protocol. It manages job requests, payments (via LN Adapter), and coordinates with the runner.
- **Runner (`runner`)**: A dedicated container running `llama.cpp` server. This separation allows the Node logic to run on lightweight hardware while the Runner can be deployed on a GPU-optimized environment (or scaled independently).
- **Admin Dashboard**: A UI for managing the Node and Router, claiming ownership (via NIP-98), and managing models.

Both the Node and Runner share the `/models` volume, allowing the Node to manage model files (download/switch) which the Runner then serves.

## Lightning adapter configuration

The compose stack includes `tools/ln-adapter`, which can talk to LNbits or LND.
By default the example uses the `mock` backend so you can run the flow without credentials.

Set one of the following before running:

```bash
export LN_ADAPTER_BACKEND=lnbits
export LNBITS_URL=https://lnbits.example.com
export LNBITS_API_KEY=your_api_key
```

Or for LND REST:

```bash
export LN_ADAPTER_BACKEND=lnd
export LND_REST_URL=https://lnd.example.com:8080
export LND_MACAROON_HEX=your_hex_macaroon
```

## Notes

- The example chat server uses `@fed-ai/sdk-js` for signing, payments, and retries.
- Response signature verification is disabled in the demo because inference responses are signed by nodes (not the router). Production clients should verify node signatures using the node public key advertised in `/nodes`.
- The server issues a mock payment receipt against the router's payment request, then retries the inference call via `inferWithPayment`.
- A mock wallet balance is displayed in the UI and decremented after each payment.
- Adjust `MAX_TOKENS`, `MODEL_ID`, `WALLET_SATS`, or `PORT` for the chat server with env vars in `docker-compose.yml`.
- Postgres stores router state and replay nonces for the example; delete the `pgdata` volume to reset the database.
- Update `ROUTER_FEDERATION_NOSTR_RELAYS` in `docker-compose.yml` if you want to point at different relays.

Local run (without Docker):

```bash
pnpm -w install
pnpm --filter @fed-ai/protocol --filter @fed-ai/nostr-relay-discovery --filter @fed-ai/sdk-js build
node examples/simple-chat/server.js
```
