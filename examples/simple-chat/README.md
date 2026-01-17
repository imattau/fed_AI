# Simple Chat Example

This example spins up a tiny web chat client, a router, a node, and a llama.cpp-backed tiny LLM inside Docker. It also exercises the mock Lightning payment flow.

## Prereqs

- Docker (for the llama.cpp server)
- Node.js LTS + pnpm

## 1) Download a small GGUF model

Pick any GGUF model and place it in `examples/simple-chat/models/`.

Example (TinyLlama Q2_K, smaller):

```bash
mkdir -p examples/simple-chat/models
curl -L -o examples/simple-chat/models/tinyllama.gguf \
  https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q2_K.gguf
```

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

## Notes

- The example chat server signs requests locally and forwards them to the router.
- The server issues a mock payment receipt against the router's payment request, then retries the inference call.
- Adjust `MAX_TOKENS`, `MODEL_ID`, or `PORT` for the chat server with env vars in `docker-compose.yml`.
