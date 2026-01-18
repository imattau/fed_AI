# Observability Checklist

Audience: operators and SREs.

## Purpose

Provide a minimum observability baseline for router and node services.

## Metrics (router)

- `router_inference_requests_total` with status labels
- `router_inference_duration_seconds` histogram
- `router_payment_requests_total`
- `router_payment_receipt_failures_total`
- `router_payment_reconciliation_failures_total`
- `router_node_failures_total`
- `router_accounting_failures_total`
- `router_federation_messages_total`
- `router_federation_jobs_total`

Suggested alerts:

- Sustained error rate > 2% on `/infer`
- Spike in `router_accounting_failures_total`
- Node failure rate above baseline
- P95 inference latency above SLO
- Federation message spike (>10 msg/s sustained)
- Federation job results drop to zero

## Metrics (node)

- `node_inference_requests_total`
- `node_inference_duration_seconds`
- `node_payment_receipt_failures_total`

Suggested alerts:

- Sustained inference error rate > 2%
- Receipt failures above baseline
- Latency regression vs baseline

## Prometheus alert rules

Starter alert rules are defined in `infra/prometheus/alerts.yml` and wired in the local
Prometheus config.

## Tracing

- Router spans: `router.infer`, `router.paymentReceipt`
- Node spans: `node.infer`

## OpenTelemetry collector

Local OTLP receiver is available via docker compose:

- gRPC: `localhost:4317`
- HTTP: `localhost:4318`

## Logging

- Log only metadata; never log prompts or outputs.
- Include request IDs and node IDs where safe.
- Routers and nodes echo `x-request-id` so clients can correlate failures.

## Dashboards

- Inference success rate, p50/p95 latency, request volume
- Payment receipt failures and accounting failures
- Node failure cooldown counts

## Local stack

With docker compose:

```
docker compose -f infra/docker-compose.yml up prometheus grafana
```

Defaults:

- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3000` (admin/admin)

Grafana provisions a starter dashboard named "fed_AI Overview".
