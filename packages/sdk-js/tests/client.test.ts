import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { generateKeyPairSync } from 'node:crypto';
import {
  buildEnvelope,
  exportPrivateKeyHex,
  exportPublicKeyHex,
  InferenceRequest,
  MeteringRecord,
  PaymentRequest,
  QuoteRequest,
  signEnvelope,
} from '@fed-ai/protocol';
import { FedAiClient, PaymentRequiredError } from '../src';

const startRouterStub = async () => {
  const routerKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyHex(routerKeys.publicKey);
  let inferAttempts = 0;
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks).toString('utf8');
    if (req.url === '/quote') {
      const request: QuoteRequest = JSON.parse(body);
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
        routerKeys.privateKey,
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
        };
        const envelope = signEnvelope(
          buildEnvelope(payment, 'nonce-pay', Date.now(), routerKeyId),
          routerKeys.privateKey,
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
        routerKeys.privateKey,
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
        routerKeys.privateKey,
      );
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ response: responseEnvelope, metering: meteringEnvelope }));
      return;
    }
    if (req.url === '/payment-receipt') {
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
  };
};

test('FedAiClient handles quotes and payments', async () => {
  const router = await startRouterStub();
  const clientKeys = generateKeyPairSync('ed25519');
  const client = new FedAiClient({
    routerUrl: router.baseUrl,
    keyId: exportPublicKeyHex(clientKeys.publicKey),
    privateKey: exportPrivateKeyHex(clientKeys.privateKey),
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
    await client.sendPaymentReceipt(receipt);
    const result = await client.infer({
      requestId: 'req-pay',
      modelId: 'mock-model',
      prompt: 'hello again',
      maxTokens: 8,
      paymentReceipts: [receipt],
    });
    assert.equal(result.response.payload.output, 'echo:hello again');
  } finally {
    await new Promise<void>((resolve) => router.server.close(() => resolve()));
  }
});
