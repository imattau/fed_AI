# Simulator

Reuses router scheduling logic to simulate workloads and costs.

Usage

```
# nodes requests seed
pnpm --filter @fed-ai/simulator sim -- 50 500 42

# pricing sensitivity scenario (multipliers)
pnpm --filter @fed-ai/simulator sim -- 50 500 42 pricing 0.5,1,2

# payment flow scenario (pay-before vs pay-after)
pnpm --filter @fed-ai/simulator sim -- 50 500 42 payments

# end-to-end scenario (routers + federation + payments)
pnpm --filter @fed-ai/simulator sim -- 90 500 42 e2e --routers 3 --nodes-per-router 30 --auction true
```

Output
- JSON metrics on stdout
- Markdown summary (after a separator)
