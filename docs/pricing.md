# Pricing

- Nodes advertise pricing in their capability metadata.
- Router uses pricing as a first-class scheduling input.
- Metering records provide verifiable usage totals.

Notes
- Prices are per-token or per-second, defined per model.
- Router may apply policies or caps per tenant.

Metering requirements
- Every inference produces a signed metering record.
- Metering records are verifiable and auditable without trusting a single operator.
