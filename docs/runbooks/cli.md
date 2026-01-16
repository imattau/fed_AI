# CLI Runbook

Audience: operators and automation.

## Purpose

Provide consistent CLI entry points for keys, quotes, inference, and manifests.

## Common commands

- Generate keys:

  ```
  pnpm --filter @fed-ai/cli dev -- gen-keys --out keys.json
  ```

- Quote request:

  ```
  pnpm --filter @fed-ai/cli dev -- quote --router http://localhost:8080 \
    --key-id <public-key-hex> --private-key <private-key-hex> --model mock-model \
    --input 8 --output 8 --max-tokens 8 --out quote.json
  ```

- Inference request:

  ```
  pnpm --filter @fed-ai/cli dev -- infer --router http://localhost:8080 \
    --key-id <public-key-hex> --private-key <private-key-hex> --model mock-model \
    --prompt "hello" --max-tokens 8 --out infer.json
  ```

- Payment receipt:

  ```
  pnpm --filter @fed-ai/cli dev -- receipt --request request.json --out receipt.json
  ```

- Relay discovery:

  ```
  pnpm --filter @fed-ai/cli dev -- relays --min-score 1 --max-results 10
  ```

## Tips

- Use `--out` to capture JSON for automation and testing.
- Keep keys in a secure location; rotate if compromised.
- Prefer explicit `--router` and `--client-key` in scripts for clarity.
