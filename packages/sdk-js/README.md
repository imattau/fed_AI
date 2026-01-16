# @fed-ai/sdk-js

JavaScript/TypeScript SDK for interacting with fed_AI control-plane services.

## Usage

```ts
import { FedAiClient } from '@fed-ai/sdk-js';

const client = new FedAiClient({
  routerUrl: 'http://localhost:8080',
  keyId: '<client-pubkey>',
  privateKey: '<client-private-key-hex-or-pem>',
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
try {
  await client.infer({
    requestId: 'req-2',
    modelId: 'mock-model',
    prompt: 'hello',
    maxTokens: 32,
  });
} catch (error) {
  if (error instanceof PaymentRequiredError) {
    const receipt = client.createPaymentReceipt(error.paymentRequest);
    await client.sendPaymentReceipt(receipt);
    const result = await client.infer({
      requestId: 'req-2',
      modelId: 'mock-model',
      prompt: 'hello',
      maxTokens: 32,
      paymentReceipts: [receipt],
    });
    console.log(result.response.payload.output);
  }
}
```

## Features

- Signing and encoding envelopes for quotes, inference requests, and receipts.
- Automatic parsing of router payment requirements via `PaymentRequiredError`.
- Helper to turn `PaymentRequest` envelopes into signed `PaymentReceipt`s.
