# Release Runbook

## Checklist

- Update version numbers
- Run lint, test, build
- Run integration smoke test
- Run pre-release security review checklist
- Tag release and publish artifacts

## Commands

```
pnpm -w lint
pnpm -w test
pnpm -w build
```

## Pre-release security review

- Confirm authZ allowlists and rate limits are configured for production.
- Verify replay protection is enabled (nonce store persistence).
- Ensure payment verification endpoints are reachable and healthy.
- Validate that logs remain redacted (no prompt/output leakage).
