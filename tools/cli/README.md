# fed_AI CLI

CLI for key generation, quotes, and signed inference requests.

Usage

```
# Generate Ed25519 key material (hex)
pnpm --filter @fed-ai/cli dev -- gen-keys

# Request a quote
pnpm --filter @fed-ai/cli dev -- quote \
  --router http://localhost:8080 \
  --key-id <public-key-hex> \
  --private-key <private-key-hex> \
  --model mock-model \
  --input 10 \
  --output 5 \
  --max-tokens 32

# Send a signed inference request
pnpm --filter @fed-ai/cli dev -- infer \
  --router http://localhost:8080 \
  --key-id <public-key-hex> \
  --private-key <private-key-hex> \
  --model mock-model \
  --prompt "hello" \
  --max-tokens 16
```
