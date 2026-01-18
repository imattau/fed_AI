# Rollback Runbook

Audience: operators and SREs.

## Purpose

Return router/node services to a known-good release safely.

## Checklist

1. Identify the last known good container/tag.
2. Preserve current configs and secrets (do not overwrite).
3. Stop new traffic or place the router in maintenance mode.

## Rollback steps (containers)

1. Update deployment to the previous tag for router/node.
2. Restart services and confirm `/health` returns `{ "ok": true }`.
3. Run the inference smoke test (signed `/infer`) end-to-end.
4. Monitor error rate and latency for 10–15 minutes.

## Rollback steps (local compose)

```
docker compose -f infra/docker-compose.yml pull
docker compose -f infra/docker-compose.yml up -d
```

## Verification

- Router `/status` lists active nodes.
- Node `/status` reports runner health.
- Payment receipts validate when required.
