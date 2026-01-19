import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import {
  buildEnvelope,
  exportPrivateKeyHex,
  exportPublicKeyNpub,
  InferenceRequest,
  MeteringRecord,
  PaymentRequest,
  QuoteRequest,
  signEnvelope,
} from '@fed-ai/protocol';
import {
  FedAiClient,
  PaymentRequiredError,
  deriveKeyId,
  generateKeyPair,
  discoverRouter,
  estimatePrice,
  filterNodes,
  filterNodesByPrice,
  isPaymentExpired,
  listModels,
  nodeAmountFromSplits,
  parseErrorDetail,
  pollUntil,
  paymentReceiptMatchesRequest,
  reconcilePaymentReceipts,
  routerFeeFromSplits,
  sumSplits,
  validateClientConfig,
} from '../src';

const startRouterStub = async () => {
  const routerPrivate = generateSecretKey();
  const routerPublic = getPublicKey(routerPrivate);
  const routerKeyId = exportPublicKeyNpub(Buffer.from(routerPublic, 'hex'));
  let inferAttempts = 0;
  let receiptAttempts = 0;
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks).toString('utf8');
    if (req.url === '/quote') {
      const envelope = JSON.parse(body) as { payload: QuoteRequest };
      const request = envelope.payload;
      const response = signEnvelope(
        buildEnvelope(
          {
            requestId: request.requestId,
            modelId: request.modelId,
            nodeId: 'node-1',
            price: { total: 1, currency: 'SAT' },
            latencyEstimateMs: 10,
            expiresAtMs: Date.now() + 1000,
          },
          'nonce-quote',
          Date.now(),
          routerKeyId,
        ),
        routerPrivate,
      );
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ quote: response }));
      return;
    }
    if (req.url === '/infer') {
      inferAttempts += 1;
      if (inferAttempts === 1) {
        const payment: PaymentRequest = {
          requestId: 'req-pay',
          payeeType: 'node',
          payeeId: 'node-1',
          amountSats: 10,
          invoice: 'lnbc1',
          expiresAtMs: Date.now() + 60000,
          splits: [
            { payeeType: 'node', payeeId: 'node-1', amountSats: 9, role: 'node-inference' },
            { payeeType: 'router', payeeId: 'router-1', amountSats: 1, role: 'router-fee' },
          ],
        };
        const envelope = signEnvelope(
          buildEnvelope(payment, 'nonce-pay', Date.now(), routerKeyId),
          routerPrivate,
        );
        res.writeHead(402, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ payment: envelope }));
        return;
      }
      const payload: InferenceRequest = JSON.parse(body).payload;
      const responseEnvelope = signEnvelope(
        buildEnvelope(
          {
            requestId: payload.requestId,
            modelId: payload.modelId,
            output: `echo:${payload.prompt}`,
            usage: { inputTokens: payload.prompt.length, outputTokens: 1 },
            latencyMs: 5,
          },
          'nonce-resp',
          Date.now(),
          routerKeyId,
        ),
        routerPrivate,
      );
      const metering: MeteringRecord = {
        requestId: payload.requestId,
        nodeId: 'node-1',
        modelId: payload.modelId,
        promptHash: 'hash',
        inputTokens: payload.prompt.length,
        outputTokens: 1,
        wallTimeMs: 5,
        bytesIn: payload.prompt.length,
        bytesOut: 1,
        ts: Date.now(),
      };
      const meteringEnvelope = signEnvelope(
        buildEnvelope(metering, 'nonce-meter', Date.now(), routerKeyId),
        routerPrivate,
      );
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ response: responseEnvelope, metering: meteringEnvelope }));
      return;
    }
    if (req.url === '/payment-receipt') {
      receiptAttempts += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    routerKeyId,
    receiptAttempts: () => receiptAttempts,
  };
};

test('FedAiClient handles quotes and payments', async () => {
  const router = await startRouterStub();
  const clientPrivate = generateSecretKey();
  const clientPublic = getPublicKey(clientPrivate);
  const client = new FedAiClient({
    routerUrl: router.baseUrl,
    keyId: exportPublicKeyNpub(Buffer.from(clientPublic, 'hex')),
    privateKey: exportPrivateKeyHex(clientPrivate),
    routerPublicKey: router.routerKeyId,
    verifyResponses: true,
  });

  const quoteEnvelope = await client.quote({
    requestId: 'quote-1',
    modelId: 'mock-model',
    maxTokens: 8,
    inputTokensEstimate: 10,
    outputTokensEstimate: 5,
  });
  assert.equal(quoteEnvelope.payload.nodeId, 'node-1');

  try {
    await client.infer({
      requestId: 'req-pay',
      modelId: 'mock-model',
      prompt: 'hello',
      maxTokens: 8,
    });
    assert.fail('infer should throw payment error');
  } catch (error) {
    assert.ok(error instanceof PaymentRequiredError);
    const receipt = client.createPaymentReceipt(error.paymentRequest);
    assert.deepEqual(receipt.payload.splits, error.paymentRequest.payload.splits);
    await client.sendPaymentReceipt(receipt);
    const result = await client.infer({
      requestId: 'req-pay',
      modelId: 'mock-model',
      prompt: 'hello again',
      maxTokens: 8,
      paymentReceipts: [receipt],
    });
    assert.equal(result.response.payload.output, 'echo:hello again');
    assert.equal(router.receiptAttempts(), 1);
  } finally {
    await new Promise<void>((resolve) => router.server.close(() => resolve()));
  }
});

test('FedAiClient inferWithPayment completes payment flow', async () => {
  const router = await startRouterStub();
  const clientPrivate = generateSecretKey();
  const clientPublic = getPublicKey(clientPrivate);
  const client = new FedAiClient({
    routerUrl: router.baseUrl,
    keyId: exportPublicKeyNpub(Buffer.from(clientPublic, 'hex')),
    privateKey: exportPrivateKeyHex(clientPrivate),
    routerPublicKey: router.routerKeyId,
    verifyResponses: true,
  });

  try {
    const result = await client.inferWithPayment({
      requestId: 'req-pay-2',
      modelId: 'mock-model',
      prompt: 'hello',
      maxTokens: 8,
    });
    assert.equal(result.response.payload.output, 'echo:hello');
    assert.equal(router.receiptAttempts(), 1);
    assert.ok(result.payment);
  } finally {
    await new Promise<void>((resolve) => router.server.close(() => resolve()));
  }
});

test('deriveKeyId returns matching npub for private key', async () => {
  const privateKey = generateSecretKey();
  const publicKey = getPublicKey(privateKey);
  const derived = deriveKeyId(exportPrivateKeyHex(privateKey), 'npub');
  assert.equal(derived, exportPublicKeyNpub(Buffer.from(publicKey, 'hex')));
});

test('generateKeyPair returns valid key material', async () => {
  const pair = generateKeyPair();
  assert.ok(pair.privateKey);
  assert.ok(pair.publicKey);
  assert.ok(pair.privateKeyHex.length > 0);
  assert.ok(pair.publicKeyHex.length > 0);
  assert.ok(pair.privateKeyNsec.startsWith('nsec'));
  assert.ok(pair.publicKeyNpub.startsWith('npub'));
});

test('discoverRouter selects the first healthy router', async () => {
  const badServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(500);
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => badServer.listen(0, resolve));
  const badAddress = badServer.address() as AddressInfo;
  const badUrl = `http://127.0.0.1:${badAddress.port}`;

  const goodServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => goodServer.listen(0, resolve));
  const goodAddress = goodServer.address() as AddressInfo;
  const goodUrl = `http://127.0.0.1:${goodAddress.port}`;

  try {
    const selected = await discoverRouter([badUrl, goodUrl]);
    assert.equal(selected.url, goodUrl);
  } finally {
    await new Promise<void>((resolve) => badServer.close(() => resolve()));
    await new Promise<void>((resolve) => goodServer.close(() => resolve()));
  }
});

test('FedAiClient rejects mismatched key id and private key', async () => {
  const privateKey = generateSecretKey();
  const otherPrivate = generateSecretKey();
  assert.throws(
    () =>
      new FedAiClient({
        routerUrl: 'http://127.0.0.1:1',
        keyId: exportPublicKeyNpub(Buffer.from(getPublicKey(otherPrivate), 'hex')),
        privateKey: exportPrivateKeyHex(privateKey),
      }),
    { message: 'key-id-mismatch' },
  );
});

test('FedAiClient surfaces payment receipt rejection details', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/payment-receipt') {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid-signature' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const clientPrivate = generateSecretKey();
  const clientPublic = getPublicKey(clientPrivate);
  const client = new FedAiClient({
    routerUrl: baseUrl,
    keyId: exportPublicKeyNpub(Buffer.from(clientPublic, 'hex')),
    privateKey: exportPrivateKeyHex(clientPrivate),
  });

  try {
    const paymentRequest = buildEnvelope(
      {
        requestId: 'req-1',
        payeeType: 'node',
        payeeId: 'node-1',
        amountSats: 10,
        invoice: 'lnbc1',
        expiresAtMs: Date.now() + 1000,
      },
      'nonce-pay',
      Date.now(),
      exportPublicKeyNpub(Buffer.from(clientPublic, 'hex')),
    );
    const receipt = client.createPaymentReceipt(paymentRequest);

    await assert.rejects(
      () => client.sendPaymentReceipt(receipt),
      { message: /invalid-signature/ },
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('FedAiClient fetches health and nodes', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.url === '/status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, uptimeMs: 1 }));
      return;
    }
    if (req.url === '/nodes') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ nodes: [{ nodeId: 'node-1' }], active: [{ nodeId: 'node-1' }] }));
      return;
    }
    if (req.url === '/metrics') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('# mock metrics');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const clientPrivate = generateSecretKey();
  const clientPublic = getPublicKey(clientPrivate);
  const client = new FedAiClient({
    routerUrl: baseUrl,
    keyId: exportPublicKeyNpub(Buffer.from(clientPublic, 'hex')),
    privateKey: exportPrivateKeyHex(clientPrivate),
  });

  try {
    const health = await client.health();
    assert.equal(health.ok, true);
    const status = await client.status();
    assert.equal(status.ok, true);
    const nodes = await client.nodes();
    assert.equal(nodes.nodes.length, 1);
    assert.equal(nodes.active.length, 1);
    const active = await client.activeNodes();
    assert.equal(active.length, 1);
    const metrics = await client.metrics();
    assert.ok(metrics.includes('mock metrics'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('FedAiClient retries GET requests when configured', async () => {
  let attempts = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      attempts += 1;
      if (attempts === 1) {
        res.writeHead(502);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const clientPrivate = generateSecretKey();
  const clientPublic = getPublicKey(clientPrivate);
  const client = new FedAiClient({
    routerUrl: baseUrl,
    keyId: exportPublicKeyNpub(Buffer.from(clientPublic, 'hex')),
    privateKey: exportPrivateKeyHex(clientPrivate),
    retry: {
      maxAttempts: 2,
      minDelayMs: 1,
      maxDelayMs: 2,
    },
  });

  try {
    const health = await client.health();
    assert.equal(health.ok, true);
    assert.equal(attempts, 2);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('validateClientConfig reports missing fields', async () => {
  const result = validateClientConfig({} as never);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.includes('router-url-missing'));
    assert.ok(result.errors.includes('key-id-missing'));
    assert.ok(result.errors.includes('private-key-missing'));
  }
});

test('parseErrorDetail extracts error fields', async () => {
  const detail = JSON.stringify({ error: 'invalid-signature', details: { foo: 'bar' } });
  const parsed = parseErrorDetail(detail);
  assert.equal(parsed.error, 'invalid-signature');
  assert.deepEqual(parsed.details, { foo: 'bar' });
});

test('filter helpers and model listing work on node descriptors', async () => {
  const nodes = [
    {
      nodeId: 'node-a',
      keyId: 'key-a',
      endpoint: 'http://node-a',
      region: 'us-east',
      capacity: { maxConcurrent: 10, currentLoad: 1 },
      trustScore: 0.9,
      capabilities: [
        {
          modelId: 'model-a',
          contextWindow: 4096,
          maxTokens: 2048,
          pricing: { unit: 'token', inputRate: 1, outputRate: 2, currency: 'SAT' },
        },
      ],
    },
    {
      nodeId: 'node-b',
      keyId: 'key-b',
      endpoint: 'http://node-b',
      region: 'eu-west',
      capacity: { maxConcurrent: 10, currentLoad: 1 },
      trustScore: 0.1,
      capabilities: [
        {
          modelId: 'model-b',
          contextWindow: 2048,
          maxTokens: 1024,
          pricing: { unit: 'token', inputRate: 5, outputRate: 5, currency: 'SAT' },
        },
      ],
    },
  ];

  const filtered = filterNodes(nodes, { modelId: 'model-a', regions: ['us-east'], minTrustScore: 0.5 });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].nodeId, 'node-a');

  const models = listModels(nodes);
  assert.equal(models.length, 2);

  const priced = filterNodesByPrice(
    nodes,
    { modelId: 'model-a', inputTokensEstimate: 2, outputTokensEstimate: 2 },
    10,
  );
  assert.equal(priced.length, 1);
  assert.equal(priced[0].nodeId, 'node-a');

  const price = estimatePrice(nodes[0].capabilities[0], { inputTokensEstimate: 2, outputTokensEstimate: 2 });
  assert.equal(price, 6);
});

test('payment helpers validate splits and receipts', async () => {
  const request: PaymentRequest = {
    requestId: 'req-1',
    payeeType: 'node',
    payeeId: 'node-1',
    amountSats: 10,
    invoice: 'lnbc1',
    expiresAtMs: Date.now() + 1000,
    splits: [
      { payeeType: 'node', payeeId: 'node-1', amountSats: 9, role: 'node-inference' },
      { payeeType: 'router', payeeId: 'router-1', amountSats: 1, role: 'router-fee' },
    ],
  };
  const receipt: PaymentReceipt = {
    requestId: 'req-1',
    payeeType: 'node',
    payeeId: 'node-1',
    amountSats: 10,
    paidAtMs: Date.now(),
    invoice: 'lnbc1',
    splits: request.splits,
  };

  assert.equal(sumSplits(request.splits), 10);
  assert.equal(routerFeeFromSplits(request.splits), 1);
  assert.equal(nodeAmountFromSplits(request.splits), 9);
  assert.equal(paymentReceiptMatchesRequest(receipt, request).ok, true);
  assert.equal(isPaymentExpired(request, Date.now() - 1), false);
});

test('reconcilePaymentReceipts reports missing and expired', async () => {
  const now = Date.now();
  const requests: PaymentRequest[] = [
    {
      requestId: 'req-1',
      payeeType: 'node',
      payeeId: 'node-1',
      amountSats: 10,
      invoice: 'lnbc1',
      expiresAtMs: now - 10,
    },
    {
      requestId: 'req-2',
      payeeType: 'node',
      payeeId: 'node-2',
      amountSats: 12,
      invoice: 'lnbc2',
      expiresAtMs: now + 10_000,
    },
  ];
  const receipts: PaymentReceipt[] = [
    {
      requestId: 'req-2',
      payeeType: 'node',
      payeeId: 'node-2',
      amountSats: 12,
      paidAtMs: now,
      invoice: 'lnbc2',
    },
  ];

  const result = reconcilePaymentReceipts(requests, receipts, now);
  assert.equal(result.missing.length, 1);
  assert.equal(result.expired.length, 1);
  assert.equal(result.missing[0].requestId, 'req-1');
});

test('pollUntil resolves when check returns value', async () => {
  let attempts = 0;
  const result = await pollUntil(async () => {
    attempts += 1;
    if (attempts < 3) {
      return null;
    }
    return 'ok';
  }, { intervalMs: 5, timeoutMs: 100 });

  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
});

test('pollUntil times out when no value returned', async () => {
  await assert.rejects(
    () => pollUntil(async () => null, { intervalMs: 5, timeoutMs: 20 }),
    { message: /poll-timeout/ },
  );
});

test('FedAiClient inferStream yields chunk and final events', async () => {
  const server = http.createServer(async (req, res) => {
    if (req.url !== '/infer/stream') {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write(`event: chunk\ndata: ${JSON.stringify({
      requestId: 'req-stream',
      modelId: 'mock-model',
      delta: 'hi',
      index: 0,
    })}\n\n`);

    const routerPrivate = generateSecretKey();
    const routerKeyId = exportPublicKeyNpub(Buffer.from(getPublicKey(routerPrivate), 'hex'));
    const responseEnvelope = signEnvelope(
      buildEnvelope(
        {
          requestId: 'req-stream',
          modelId: 'mock-model',
          output: 'hi',
          usage: { inputTokens: 1, outputTokens: 1 },
          latencyMs: 5,
        },
        'nonce-resp',
        Date.now(),
        routerKeyId,
      ),
      routerPrivate,
    );
    const meteringEnvelope = signEnvelope(
      buildEnvelope(
        {
          requestId: 'req-stream',
          nodeId: 'node-1',
          modelId: 'mock-model',
          promptHash: 'hash',
          inputTokens: 1,
          outputTokens: 1,
          wallTimeMs: 5,
          bytesIn: 1,
          bytesOut: 2,
          ts: Date.now(),
        },
        'nonce-meter',
        Date.now(),
        routerKeyId,
      ),
      routerPrivate,
    );
    res.write(`event: final\ndata: ${JSON.stringify({
      response: responseEnvelope,
      metering: meteringEnvelope,
    })}\n\n`);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const clientPrivate = generateSecretKey();
  const clientPublic = getPublicKey(clientPrivate);
  const client = new FedAiClient({
    routerUrl: baseUrl,
    keyId: exportPublicKeyNpub(Buffer.from(clientPublic, 'hex')),
    privateKey: exportPrivateKeyHex(clientPrivate),
  });

  try {
    const events: string[] = [];
    for await (const event of client.inferStream({
      requestId: 'req-stream',
      modelId: 'mock-model',
      prompt: 'hello',
      maxTokens: 8,
    })) {
      events.push(event.type);
    }
    assert.deepEqual(events, ['chunk', 'final']);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
