# Local Development Runbook

Audience: coding agents and contributors.

## Prerequisites

- Node.js LTS
- pnpm
- Docker (for compose)

## Workspace setup

1. Install dependencies:

   ```
   pnpm install
   ```

2. Build shared packages:

   ```
   pnpm -w build
   ```

3. Generate local dev keys (writes `.env` at repo root):

   ```
   tools/scripts/gen-keys.sh
   ```

## Running services

- Start router + node via compose:

  ```
  docker compose -f infra/docker-compose.yml up
  ```

- Run dev mode (if configured):

  ```
  pnpm -w dev
  ```

## Common tasks

- Lint: `pnpm -w lint`
- Test: `pnpm -w test`
- Simulator: `pnpm -w sim`
- CLI infer: `pnpm -w cli infer`

## Operator references

- Router ops: `docs/runbooks/router-ops.md`
- Node ops: `docs/runbooks/node-ops.md`
- CLI: `docs/runbooks/cli.md`
- Observability: `docs/runbooks/observability.md`
