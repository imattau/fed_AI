# Simple Chat Example

This example spins up a tiny web chat client, a router, a node, and a llama.cpp-backed tiny LLM inside Docker. It also exercises the mock Lightning payment flow.

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

Ports:
- Router: `http://localhost:18080`
- llama.cpp: `http://localhost:18085`

## Notes

- The example chat server signs requests locally and forwards them to the router.
- The server issues a mock payment receipt against the router's payment request, then retries the inference call.
- Adjust `MAX_TOKENS`, `MODEL_ID`, or `PORT` for the chat server with env vars in `docker-compose.yml`.
