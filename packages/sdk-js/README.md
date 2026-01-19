# @fed-ai/sdk-js

JavaScript/TypeScript SDK for interacting with fed_AI control-plane services.

## Usage

```ts
import { FedAiClient } from '@fed-ai/sdk-js';
import { deriveKeyId, generateKeyPair } from '@fed-ai/sdk-js';

const privateKey = '<client-private-key-hex-or-nsec>';
const keyId = deriveKeyId(privateKey);

const client = new FedAiClient({
  routerUrl: 'http://localhost:8080',
  keyId,
  privateKey,
  routerPublicKey: '<router-npub>',
  verifyResponses: true,
  retry: {
    maxAttempts: 2,
    minDelayMs: 50,
    maxDelayMs: 200,
  },
});

const quote = await client.quote({
  requestId: 'req-1',
  modelId: 'mock-model',
  maxTokens: 64,
  inputTokensEstimate: 10,
  outputTokensEstimate: 20,
});

console.log('Quote:', quote.payload);
```

## Payment helpers

```ts
const result = await client.inferWithPayment({
  requestId: 'req-2',
  modelId: 'mock-model',
  prompt: 'hello',
  maxTokens: 32,
});
console.log(result.response.payload.output);
```

## Payment ops helpers

```ts
import { sumSplits, routerFeeFromSplits, paymentReceiptMatchesRequest } from '@fed-ai/sdk-js';

const feeSats = routerFeeFromSplits(request.payload.splits);
const total = sumSplits(request.payload.splits);
const match = paymentReceiptMatchesRequest(receipt.payload, request.payload);
```

## Diagnostics helpers

```ts
const health = await client.health();
const status = await client.status();
const nodes = await client.nodes();
```

## Node helpers

```ts
import { filterNodes, listModels } from '@fed-ai/sdk-js';

const nodeList = (await client.nodes()).nodes;
const models = listModels(nodeList);
const filtered = filterNodes(nodeList, { modelId: 'model-a', minTrustScore: 0.5 });
```

## Batch quotes

```ts
const { quotes, failures } = await client.quoteBatch([
  { requestId: 'q1', modelId: 'model-a', maxTokens: 32, inputTokensEstimate: 10, outputTokensEstimate: 5 },
  { requestId: 'q2', modelId: 'model-b', maxTokens: 32, inputTokensEstimate: 10, outputTokensEstimate: 5 },
]);
```

## Per-request retry overrides

```ts
await client.infer(
  { requestId: 'req-3', modelId: 'model-a', prompt: 'hi', maxTokens: 8 },
  { retry: { maxAttempts: 1 } },
);
```

## Discovery helpers

```ts
import { discoverRouter, discoverRelays } from '@fed-ai/sdk-js';

const router = await discoverRouter(['http://router-a:8080', 'http://router-b:8080']);
const relays = await discoverRelays();
```

## Key helpers

```ts
const keyPair = generateKeyPair();
console.log(keyPair.publicKeyNpub);
```

## Features

- Signing and encoding envelopes for quotes, inference requests, and receipts.
- Optional response validation + signature verification when `routerPublicKey` is provided.
- Automatic parsing of router payment requirements via `PaymentRequiredError`.
- Helper to turn `PaymentRequest` envelopes into signed `PaymentReceipt`s.
- `inferWithPayment` helper that retries after submitting receipts.
- Health/status/nodes helpers for basic router diagnostics.
- `deriveKeyId` for safe key-id derivation from a private key.
- Router discovery and relay discovery helpers.
- Basic HTTP retry support (configurable).
- Node filtering + model listing helpers.
- Batch quote helper for multi-model requests.
- Config validation helpers and error detail parsing utilities.
- Payment split/receipt validation helpers for client-side reconciliation.

Retry note: retries are applied to `GET` requests by default. To retry `POST` requests, set
`retry.methods` to include `'POST'` (use with care for non-idempotent calls).

## Browser note

The SDK uses `globalThis.crypto.randomUUID()` when available. Provide a secure RNG in older
browser environments.
