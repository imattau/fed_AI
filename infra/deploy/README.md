# Production Compose

This directory contains a production-oriented Docker Compose file that wires router, node,
Prometheus, Grafana, and the OpenTelemetry collector.

Usage

```
export ROUTER_ENDPOINT=https://router.example.com
export ROUTER_KEY_ID=npub...
export ROUTER_PRIVATE_KEY_PEM=nsec...
export ROUTER_DB_URL=postgres://user:pass@db:5432/fedai
export ROUTER_NONCE_STORE_URL=postgres://user:pass@db:5432/fedai
export NODE_ENDPOINT=https://node.example.com
export NODE_KEY_ID=npub...
export NODE_PRIVATE_KEY_PEM=nsec...
export ROUTER_PUBLIC_KEY_PEM=npub...

docker compose -f infra/deploy/docker-compose.prod.yml up -d
```

Notes
- Use externally managed Postgres and Lightning services.
- Apply SQL migrations from `infra/sql` before first boot.
