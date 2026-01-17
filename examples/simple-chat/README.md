# Simple Chat Example

This example spins up a tiny web chat client, a router, a node, and a llama.cpp-backed tiny LLM. It also exercises the mock Lightning payment flow.

## Prereqs

- Docker (for the llama.cpp server)
- Node.js LTS + pnpm

## 1) Download a small GGUF model

Pick any GGUF model and place it in `examples/simple-chat/models/`.

Example (TinyLlama Q4):

```bash
mkdir -p examples/simple-chat/models
curl -L -o examples/simple-chat/models/tinyllama.gguf \
  https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf
```

## 2) Start llama.cpp server

```bash
docker run --rm -p 8085:8080 \
  -v "$(pwd)/examples/simple-chat/models:/models" \
  ghcr.io/ggerganov/llama.cpp:server \
  -m /models/tinyllama.gguf -c 2048 --host 0.0.0.0 --port 8080
```

## 3) Generate keys

```bash
./tools/scripts/gen-keys.sh
```

This writes `.env` at repo root. Leave it there.

## 4) Start router (payment required)

```bash
export $(cat .env | xargs)
ROUTER_ENDPOINT=http://localhost:8080 \
ROUTER_REQUIRE_PAYMENT=true \
pnpm --filter @fed-ai/router dev
```

## 5) Start node (llama.cpp runner, payment required)

```bash
export $(cat .env | xargs)
NODE_RUNNER=llama_cpp \
NODE_LLAMA_CPP_URL=http://localhost:8085 \
NODE_MODEL_ID=tinyllama \
ROUTER_ENDPOINT=http://localhost:8080 \
ROUTER_PUBLIC_KEY_PEM=$ROUTER_PUBLIC_KEY_PEM \
ROUTER_KEY_ID=$ROUTER_KEY_ID \
NODE_REQUIRE_PAYMENT=true \
pnpm --filter @fed-ai/node dev
```

## 6) Start the web chat client

```bash
ROUTER_URL=http://localhost:8080 node examples/simple-chat/server.js
```

Open `http://localhost:3000` and send a prompt.

## Notes

- The example chat server signs requests locally and forwards them to the router.
- The server issues a mock payment receipt against the router's payment request, then retries the inference call.
- Adjust `MAX_TOKENS`, `MODEL_ID`, or `PORT` for the chat server with env vars.
