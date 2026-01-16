# Pricing

- Nodes advertise pricing in their capability metadata.
- Router uses pricing as a first-class scheduling input.
- Metering records provide verifiable usage totals.

Notes
- Prices are per-token or per-second, defined per model.
- Router may apply policies or caps per tenant.
 - Quote responses are derived from node capability pricing and request estimates.

Metering requirements
- Every inference produces a signed metering record.
- Metering records are verifiable and auditable without trusting a single operator.

Lightning alignment
- Metering records are designed to support Lightning settlement for pay-as-you-go usage.
- `PaymentRequest` and `PaymentReceipt` formalize settlement messages.
