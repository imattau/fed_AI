# fed_AI CLI

CLI for key generation, quotes, profiling, and signed inference requests.

Usage

```
# Generate Ed25519 key material (hex)
pnpm --filter @fed-ai/cli dev -- gen-keys

# Profile hardware/network
pnpm --filter @fed-ai/cli dev -- profile --latency-targets 1.1.1.1,8.8.8.8

# Run benchmarks
pnpm --filter @fed-ai/cli dev -- bench --mode node --latency-targets 1.1.1.1

# Recommend roles
pnpm --filter @fed-ai/cli dev -- recommend --profile profile.json --bench bench.json

# Write a signed manifest
pnpm --filter @fed-ai/cli dev -- manifest \
  --role node \
  --id node-1 \
  --key-id <public-key-hex> \
  --private-key <private-key-hex> \
  --profile profile.json \
  --bench bench.json \
  --write node.manifest.json

# Request a quote
pnpm --filter @fed-ai/cli dev -- quote \
  --router http://localhost:8080 \
  --key-id <public-key-hex> \
  --private-key <private-key-hex> \
  --model mock-model \
  --input 10 \
  --output 5 \
  --max-tokens 32

# Send a signed inference request (optionally attach previously saved receipts)
pnpm --filter @fed-ai/cli dev -- infer \
  --router http://localhost:8080 \
  --key-id <public-key-hex> \
  --private-key <private-key-hex> \
  --model mock-model \
  --prompt "hello" \
  --max-tokens 16 \
  --receipts node-receipt.json \
  --payment-request-out invoice.json

# Convert a saved payment request into a signed receipt
pnpm --filter @fed-ai/cli dev -- receipt \
  --payment-request invoice.json \
  --key-id <public-key-hex> \
  --private-key <private-key-hex> \
  --router http://localhost:8080 \
  --write node-receipt.json

# Discover candidate relays
pnpm --filter @fed-ai/cli dev -- relays \
  --aggregators https://relays.nostr.info/relays.json \
  --trust-scores wss://relay.nostr.info=5,wss://relay.snort.social=4 \
  --max-results 10
```
