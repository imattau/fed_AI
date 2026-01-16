import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { createHash, generateKeyPairSync, KeyObject } from 'node:crypto';
import {
  buildEnvelope,
  exportPublicKeyHex,
  signEnvelope,
  validateEnvelope,
  validateInferenceResponse,
  validateMeteringRecord,
  validatePaymentRequest,
  validateQuoteResponse,
  verifyEnvelope,
} from '@fed-ai/protocol';
import { createRouterService } from '../src/server';
import { createRouterHttpServer } from '../src/http';
import type {
  Envelope,
  InferenceRequest,
  NodeDescriptor,
  MeteringRecord,
  InferenceResponse,
  PaymentReceipt,
  QuoteRequest,
  QuoteResponse,
} from '@fed-ai/protocol';
import type { RouterConfig } from '../src/config';

const startRouter = async (config: RouterConfig) => {
  const service = createRouterService(config);
  const server = createRouterHttpServer(service, config);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
};

const startStubNode = async (nodeKeyId: string, privateKey: KeyObject) => {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/infer') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        payload: InferenceRequest;
      };

      const responsePayload: InferenceResponse = {
        requestId: body.payload.requestId,
        modelId: body.payload.modelId,
        output: 'ok',
        usage: { inputTokens: 1, outputTokens: 1 },
        latencyMs: 5,
      };

      const meteringPayload: MeteringRecord = {
        requestId: body.payload.requestId,
        nodeId: 'node-1',
        modelId: body.payload.modelId,
        promptHash: createHash('sha256').update(body.payload.prompt, 'utf8').digest('hex'),
        inputTokens: 1,
        outputTokens: 1,
        wallTimeMs: 5,
        bytesIn: body.payload.prompt.length,
        bytesOut: 2,
        ts: Date.now(),
      };

      const responseEnvelope = signEnvelope(
        buildEnvelope(responsePayload, 'nonce-resp', Date.now(), nodeKeyId),
        privateKey,
      );
      const meteringEnvelope = signEnvelope(
        buildEnvelope(meteringPayload, 'nonce-meter', Date.now(), nodeKeyId),
        privateKey,
      );

      const payload = JSON.stringify({ response: responseEnvelope, metering: meteringEnvelope });
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
      res.end(payload);
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
};

test('router /infer returns 503 when no nodes', async () => {
  const routerKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyHex(routerKeys.publicKey);
  const config: RouterConfig = {
    routerId: 'router-1',
    keyId: routerKeyId,
    endpoint: 'http://localhost:0',
    port: 0,
    privateKey: routerKeys.privateKey,
    requirePayment: false,
  };

  const { server, baseUrl } = await startRouter(config);
  const clientKeys = generateKeyPairSync('ed25519');
  const clientKeyId = exportPublicKeyHex(clientKeys.publicKey);
  const payload: InferenceRequest = {
    requestId: 'req-1',
    modelId: 'mock-model',
    prompt: 'hello',
    maxTokens: 8,
  };

  const requestEnvelope = signEnvelope(
    buildEnvelope(payload, 'nonce-1', Date.now(), clientKeyId),
    clientKeys.privateKey,
  );

  const response = await fetch(`${baseUrl}/infer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestEnvelope),
  });

  assert.equal(response.status, 503);
  server.close();
});

test('router /infer forwards to node and verifies signatures', async () => {
  const routerKeys = generateKeyPairSync('ed25519');
  const nodeKeys = generateKeyPairSync('ed25519');
  const clientKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyHex(routerKeys.publicKey);
  const nodeKeyId = exportPublicKeyHex(nodeKeys.publicKey);
  const clientKeyId = exportPublicKeyHex(clientKeys.publicKey);

  const { server: nodeServer, baseUrl: nodeUrl } = await startStubNode(
    nodeKeyId,
    nodeKeys.privateKey,
  );

  const config: RouterConfig = {
    routerId: 'router-1',
    keyId: routerKeyId,
    endpoint: 'http://localhost:0',
    port: 0,
    privateKey: routerKeys.privateKey,
    requirePayment: false,
  };

  const { server: routerServer, baseUrl: routerUrl } = await startRouter(config);

  const nodeDescriptor: NodeDescriptor = {
    nodeId: 'node-1',
    keyId: nodeKeyId,
    endpoint: nodeUrl,
    capacity: { maxConcurrent: 10, currentLoad: 0 },
    capabilities: [
      {
        modelId: 'mock-model',
        contextWindow: 4096,
        maxTokens: 1024,
        pricing: { unit: 'token', inputRate: 0, outputRate: 0, currency: 'USD' },
      },
    ],
  };

  const registrationEnvelope = signEnvelope(
    buildEnvelope(nodeDescriptor, 'nonce-node', Date.now(), nodeKeyId),
    nodeKeys.privateKey,
  );

  const registerResponse = await fetch(`${routerUrl}/register-node`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(registrationEnvelope),
  });

  assert.equal(registerResponse.status, 200);

  const clientRequest: InferenceRequest = {
    requestId: 'req-2',
    modelId: 'mock-model',
    prompt: 'hello',
    maxTokens: 8,
  };

  const requestEnvelope = signEnvelope(
    buildEnvelope(clientRequest, 'nonce-client', Date.now(), clientKeyId),
    clientKeys.privateKey,
  );

  const response = await fetch(`${routerUrl}/infer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestEnvelope),
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as { response: unknown; metering: unknown };

  const responseValidation = validateEnvelope(body.response, validateInferenceResponse);
  assert.equal(responseValidation.ok, true);
  const meteringValidation = validateEnvelope(body.metering, validateMeteringRecord);
  assert.equal(meteringValidation.ok, true);

  routerServer.close();
  nodeServer.close();
});

test('router /infer enforces payment when required', async () => {
  const routerKeys = generateKeyPairSync('ed25519');
  const nodeKeys = generateKeyPairSync('ed25519');
  const clientKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyHex(routerKeys.publicKey);
  const nodeKeyId = exportPublicKeyHex(nodeKeys.publicKey);
  const clientKeyId = exportPublicKeyHex(clientKeys.publicKey);

  const { server: nodeServer, baseUrl: nodeUrl } = await startStubNode(
    nodeKeyId,
    nodeKeys.privateKey,
  );

  const config: RouterConfig = {
    routerId: 'router-1',
    keyId: routerKeyId,
    endpoint: 'http://localhost:0',
    port: 0,
    privateKey: routerKeys.privateKey,
    requirePayment: true,
  };

  const { server: routerServer, baseUrl: routerUrl } = await startRouter(config);

  const nodeDescriptor: NodeDescriptor = {
    nodeId: 'node-1',
    keyId: nodeKeyId,
    endpoint: nodeUrl,
    capacity: { maxConcurrent: 10, currentLoad: 0 },
    capabilities: [
      {
        modelId: 'mock-model',
        contextWindow: 4096,
        maxTokens: 1024,
        pricing: { unit: 'token', inputRate: 1, outputRate: 1, currency: 'SAT' },
      },
    ],
  };

  const registrationEnvelope = signEnvelope(
    buildEnvelope(nodeDescriptor, 'nonce-node-pay', Date.now(), nodeKeyId),
    nodeKeys.privateKey,
  );

  try {
    const registerResponse = await fetch(`${routerUrl}/register-node`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(registrationEnvelope),
    });

    assert.equal(registerResponse.status, 200);

    const clientRequest: InferenceRequest = {
      requestId: 'req-pay',
      modelId: 'mock-model',
      prompt: 'hello',
      maxTokens: 8,
    };

    const requestEnvelope = signEnvelope(
      buildEnvelope(clientRequest, 'nonce-client-pay', Date.now(), clientKeyId),
      clientKeys.privateKey,
    );

    const paymentResponse = await fetch(`${routerUrl}/infer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestEnvelope),
    });

    const paymentBodyText = await paymentResponse.text();
    assert.equal(
      paymentResponse.status,
      402,
      `expected 402 got ${paymentResponse.status} body=${paymentBodyText}`,
    );
    const paymentBody = JSON.parse(paymentBodyText) as { payment: unknown };
    const paymentValidation = validateEnvelope(paymentBody.payment, validatePaymentRequest);
    assert.equal(paymentValidation.ok, true);
    const paymentEnvelope = paymentBody.payment as Envelope<{ nodeId: string; requestId: string }>;
    assert.equal(paymentEnvelope.payload.requestId, clientRequest.requestId);

    const receipt: PaymentReceipt = {
      requestId: paymentEnvelope.payload.requestId,
      nodeId: paymentEnvelope.payload.nodeId,
      amountSats: 16,
      paidAtMs: Date.now(),
    };

    const receiptEnvelope = signEnvelope(
      buildEnvelope(receipt, 'nonce-receipt', Date.now(), clientKeyId),
      clientKeys.privateKey,
    );

    const receiptResponse = await fetch(`${routerUrl}/payment-receipt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(receiptEnvelope),
    });

    assert.equal(receiptResponse.status, 200);

    const retryEnvelope = signEnvelope(
      buildEnvelope(clientRequest, 'nonce-client-pay-retry', Date.now(), clientKeyId),
      clientKeys.privateKey,
    );

    const inferResponse = await fetch(`${routerUrl}/infer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(retryEnvelope),
    });

    const inferBodyText = await inferResponse.text();
    assert.equal(
      inferResponse.status,
      200,
      `expected 200 got ${inferResponse.status} body=${inferBodyText}`,
    );
  } finally {
    routerServer.close();
    nodeServer.close();
  }
});

test('router /quote returns signed quote response', async () => {
  const routerKeys = generateKeyPairSync('ed25519');
  const clientKeys = generateKeyPairSync('ed25519');
  const nodeKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyHex(routerKeys.publicKey);
  const clientKeyId = exportPublicKeyHex(clientKeys.publicKey);
  const nodeKeyId = exportPublicKeyHex(nodeKeys.publicKey);

  const config: RouterConfig = {
    routerId: 'router-1',
    keyId: routerKeyId,
    endpoint: 'http://localhost:0',
    port: 0,
    privateKey: routerKeys.privateKey,
    requirePayment: false,
  };

  const service = createRouterService(config);
  const nodeDescriptor: NodeDescriptor = {
    nodeId: 'node-1',
    keyId: nodeKeyId,
    endpoint: 'http://localhost:9999',
    capacity: { maxConcurrent: 10, currentLoad: 0 },
    capabilities: [
      {
        modelId: 'mock-model',
        contextWindow: 4096,
        maxTokens: 1024,
        pricing: { unit: 'token', inputRate: 0.01, outputRate: 0.02, currency: 'USD' },
      },
    ],
  };
  service.nodes.push(nodeDescriptor);

  const server = createRouterHttpServer(service, config);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const quoteRequest: QuoteRequest = {
    requestId: 'req-quote',
    modelId: 'mock-model',
    maxTokens: 32,
    inputTokensEstimate: 10,
    outputTokensEstimate: 5,
  };

  const requestEnvelope = signEnvelope(
    buildEnvelope(quoteRequest, 'nonce-quote', Date.now(), clientKeyId),
    clientKeys.privateKey,
  );

  const response = await fetch(`${baseUrl}/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestEnvelope),
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as { quote: unknown };
  const validation = validateEnvelope(body.quote, validateQuoteResponse);
  assert.equal(validation.ok, true);

  const envelope = body.quote as Envelope<QuoteResponse>;
  assert.equal(envelope.keyId, config.keyId);
  assert.equal(verifyEnvelope(envelope, routerKeys.publicKey), true);

  server.close();
});
