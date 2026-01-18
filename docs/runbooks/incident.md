# Incident Runbook

Audience: operators and SREs.

## Purpose

Provide a minimal response guide for outages, payment failures, or routing instability.

## Immediate triage

1. Capture `x-request-id` from the client or gateway logs.
2. Check `router_inference_requests_total` error rate and `router_inference_duration_seconds` p95.
3. Inspect `router_payment_receipt_failures_total` and `router_payment_reconciliation_failures_total`.
4. Check node health (`/status`) and node error rate (`node_inference_requests_total{status!~"2.."}`).
5. Verify relay connectivity and federation offload counts if enabled.

## Containment

- If payment errors spike, temporarily set `ROUTER_REQUIRE_PAYMENT=false` for critical traffic.
- If a node is misbehaving, remove it from rotation or raise cooldown thresholds.
- If federation relays flap, disable federation or pin a trusted relay list.

## Recovery steps

- Roll back to last known good image/config.
- Re-run smoke check (`/health`, `/status`, signed `/infer`).
- Restore `ROUTER_REQUIRE_PAYMENT=true` once receipts validate again.

## Post-incident

- Document timeline and affected request IDs.
- Add a regression test or alert for the failure mode.
