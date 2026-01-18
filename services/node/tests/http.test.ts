import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import {
  buildEnvelope,
  exportPublicKeyNpub,
  signEnvelope,
  validateEnvelope,
  validateInferenceResponse,
  validateMeteringRecord,
  verifyEnvelope,
} from '@fed-ai/protocol';
import { createNodeService } from '../src/server';
import { createNodeHttpServer } from '../src/http';
import { MockRunner } from './helpers/mock-runner';
import type {
  Envelope,
  InferenceRequest,
  InferenceResponse,
  MeteringRecord,
  PaymentReceipt,
} from '@fed-ai/protocol';
import type { NodeConfig } from '../src/config';

const startServer = async (config: NodeConfig, runner = new MockRunner()) => {
  const service = createNodeService(config, runner);
  const server = createNodeHttpServer(service, config);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
};

const closeServer = (server: Server) => {
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  return new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
};

test('node /infer rejects when router public key missing', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const { publicKey: routerPublicKey } = generateKeyPairSync('ed25519');
  const config: NodeConfig = {
    nodeId: 'node-1',
    keyId: exportPublicKeyNpub(publicKey),
    endpoint: 'http://localhost:0',
    routerEndpoint: 'http://localhost:8080',
    heartbeatIntervalMs: 10_000,
    runnerName: 'mock',
    port: 0,
    capacityMaxConcurrent: 4,
    capacityCurrentLoad: 0,
    requirePayment: false,
    privateKey,
  };

  const { server, baseUrl } = await startServer(config);
  const payload: InferenceRequest = {
    requestId: 'req-1',
    modelId: 'mock-model',
    prompt: 'hello',
    maxTokens: 8,
  };
  const envelope = buildEnvelope(payload, 'nonce-1', Date.now(), exportPublicKeyNpub(routerPublicKey));
  const response = await fetch(`${baseUrl}/infer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(envelope),
  });

  assert.equal(response.status, 500);

  await closeServer(server);
});

test('node /infer validates signatures and returns signed response', async () => {
  const nodeKeys = generateKeyPairSync('ed25519');
  const routerKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyNpub(routerKeys.publicKey);
  const nodeKeyId = exportPublicKeyNpub(nodeKeys.publicKey);

  const config: NodeConfig = {
    nodeId: 'node-1',
    keyId: nodeKeyId,
    endpoint: 'http://localhost:0',
    routerEndpoint: 'http://localhost:8080',
    heartbeatIntervalMs: 10_000,
    runnerName: 'mock',
    port: 0,
    capacityMaxConcurrent: 4,
    capacityCurrentLoad: 0,
    requirePayment: false,
    privateKey: nodeKeys.privateKey,
    routerPublicKey: routerKeys.publicKey,
  };

  const { server, baseUrl } = await startServer(config);
  const payload: InferenceRequest = {
    requestId: 'req-2',
    modelId: 'mock-model',
    prompt: 'hello',
    maxTokens: 8,
  };

  const requestEnvelope = signEnvelope(
    buildEnvelope(payload, 'nonce-2', Date.now(), routerKeyId),
    routerKeys.privateKey,
  );

  const response = await fetch(`${baseUrl}/infer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestEnvelope),
  });

  assert.equal(response.status, 200);

  const body = (await response.json()) as {
    response: unknown;
    metering: unknown;
  };

  const responseValidation = validateEnvelope(body.response, validateInferenceResponse);
  assert.equal(responseValidation.ok, true);
  const meteringValidation = validateEnvelope(body.metering, validateMeteringRecord);
  assert.equal(meteringValidation.ok, true);

  const responseEnvelope = body.response as Envelope<InferenceResponse>;
  const meteringEnvelope = body.metering as Envelope<MeteringRecord>;
  assert.equal(responseEnvelope.keyId, config.keyId);
  assert.equal(verifyEnvelope(responseEnvelope, nodeKeys.publicKey), true);
  assert.equal(verifyEnvelope(meteringEnvelope, nodeKeys.publicKey), true);

  await closeServer(server);
});

test('node /infer rejects when router key id mismatches', async () => {
  const nodeKeys = generateKeyPairSync('ed25519');
  const routerKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyNpub(routerKeys.publicKey);
  const nodeKeyId = exportPublicKeyNpub(nodeKeys.publicKey);

  const config: NodeConfig = {
    nodeId: 'node-1',
    keyId: nodeKeyId,
    endpoint: 'http://localhost:0',
    routerEndpoint: 'http://localhost:8080',
    routerKeyId,
    heartbeatIntervalMs: 10_000,
    runnerName: 'mock',
    port: 0,
    capacityMaxConcurrent: 4,
    capacityCurrentLoad: 0,
    requirePayment: false,
    privateKey: nodeKeys.privateKey,
    routerPublicKey: routerKeys.publicKey,
  };

  const { server, baseUrl } = await startServer(config);
  const payload: InferenceRequest = {
    requestId: 'req-key-id',
    modelId: 'mock-model',
    prompt: 'hello',
    maxTokens: 8,
  };
  const { publicKey: overridePublicKey } = generateKeyPairSync('ed25519');
  const overrideKeyId = exportPublicKeyNpub(overridePublicKey);

  const requestEnvelope = signEnvelope(
    buildEnvelope(payload, 'nonce-key-id', Date.now(), overrideKeyId),
    routerKeys.privateKey,
  );

  const response = await fetch(`${baseUrl}/infer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestEnvelope),
  });

  assert.equal(response.status, 401);
  await closeServer(server);
});

test('node /infer requires payment when configured', async () => {
  const nodeKeys = generateKeyPairSync('ed25519');
  const routerKeys = generateKeyPairSync('ed25519');
  const clientKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyNpub(routerKeys.publicKey);
  const nodeKeyId = exportPublicKeyNpub(nodeKeys.publicKey);
  const clientKeyId = exportPublicKeyNpub(clientKeys.publicKey);

  const config: NodeConfig = {
    nodeId: 'node-1',
    keyId: nodeKeyId,
    endpoint: 'http://localhost:0',
    routerEndpoint: 'http://localhost:8080',
    heartbeatIntervalMs: 10_000,
    runnerName: 'mock',
    port: 0,
    capacityMaxConcurrent: 4,
    capacityCurrentLoad: 0,
    requirePayment: true,
    privateKey: nodeKeys.privateKey,
    routerPublicKey: routerKeys.publicKey,
  };

  const { server, baseUrl } = await startServer(config);
  const payload: InferenceRequest = {
    requestId: 'req-pay',
    modelId: 'mock-model',
    prompt: 'hello',
    maxTokens: 8,
  };

  const requestEnvelope = signEnvelope(
    buildEnvelope(payload, 'nonce-pay', Date.now(), routerKeyId),
    routerKeys.privateKey,
  );

  const response = await fetch(`${baseUrl}/infer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestEnvelope),
  });

  assert.equal(response.status, 402);

  const badReceiptPayload = {
    requestId: 'req-wrong',
    payeeType: 'node',
    payeeId: config.nodeId,
    amountSats: 100,
    paidAtMs: Date.now(),
  };

  const badReceipt: Envelope<PaymentReceipt> = signEnvelope(
    buildEnvelope(badReceiptPayload, 'nonce-receipt-bad', Date.now(), clientKeyId),
    clientKeys.privateKey,
  );

  const badPayload: InferenceRequest = {
    ...payload,
    paymentReceipts: [badReceipt],
  };

  const badEnvelope = signEnvelope(
    buildEnvelope(badPayload, 'nonce-paid-bad', Date.now(), routerKeyId),
    routerKeys.privateKey,
  );

  const badResponse = await fetch(`${baseUrl}/infer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(badEnvelope),
  });

  assert.equal(badResponse.status, 400);

  const receiptPayload = {
    requestId: payload.requestId,
    payeeType: 'node',
    payeeId: config.nodeId,
    amountSats: 100,
    paidAtMs: Date.now(),
  };

  const receipt: Envelope<PaymentReceipt> = signEnvelope(
    buildEnvelope(receiptPayload, 'nonce-receipt', Date.now(), clientKeyId),
    clientKeys.privateKey,
  );

  const paidPayload: InferenceRequest = {
    ...payload,
    paymentReceipts: [receipt],
  };

  const paidEnvelope = signEnvelope(
    buildEnvelope(paidPayload, 'nonce-paid', Date.now(), routerKeyId),
    routerKeys.privateKey,
  );

  const paidResponse = await fetch(`${baseUrl}/infer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(paidEnvelope),
  });

  assert.equal(paidResponse.status, 200);

  await closeServer(server);
});

test('node /infer enforces capacity limits', async () => {
  const nodeKeys = generateKeyPairSync('ed25519');
  const routerKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyNpub(routerKeys.publicKey);
  const nodeKeyId = exportPublicKeyNpub(nodeKeys.publicKey);

  const config: NodeConfig = {
    nodeId: 'node-1',
    keyId: nodeKeyId,
    endpoint: 'http://localhost:0',
    routerEndpoint: 'http://localhost:8080',
    heartbeatIntervalMs: 10_000,
    runnerName: 'mock',
    port: 0,
    capacityMaxConcurrent: 0,
    capacityCurrentLoad: 0,
    requirePayment: false,
    privateKey: nodeKeys.privateKey,
    routerPublicKey: routerKeys.publicKey,
  };

  const { server, baseUrl } = await startServer(config);
  const payload: InferenceRequest = {
    requestId: 'req-cap',
    modelId: 'mock-model',
    prompt: 'hello',
    maxTokens: 8,
  };

  const requestEnvelope = signEnvelope(
    buildEnvelope(payload, 'nonce-cap', Date.now(), routerKeyId),
    routerKeys.privateKey,
  );

  const response = await fetch(`${baseUrl}/infer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestEnvelope),
  });

  assert.equal(response.status, 429);
  await closeServer(server);
});

test('node /infer enforces prompt and token limits', async () => {
  const nodeKeys = generateKeyPairSync('ed25519');
  const routerKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyNpub(routerKeys.publicKey);
  const nodeKeyId = exportPublicKeyNpub(nodeKeys.publicKey);

  const config: NodeConfig = {
    nodeId: 'node-1',
    keyId: nodeKeyId,
    endpoint: 'http://localhost:0',
    routerEndpoint: 'http://localhost:8080',
    heartbeatIntervalMs: 10_000,
    runnerName: 'mock',
    port: 0,
    capacityMaxConcurrent: 4,
    capacityCurrentLoad: 0,
    maxPromptBytes: 3,
    maxTokens: 4,
    requirePayment: false,
    privateKey: nodeKeys.privateKey,
    routerPublicKey: routerKeys.publicKey,
  };

  const { server, baseUrl } = await startServer(config);
  const tooLargePrompt: InferenceRequest = {
    requestId: 'req-prompt',
    modelId: 'mock-model',
    prompt: 'hello',
    maxTokens: 2,
  };
  const largePromptEnvelope = signEnvelope(
    buildEnvelope(tooLargePrompt, 'nonce-prompt', Date.now(), routerKeyId),
    routerKeys.privateKey,
  );
  const promptResponse = await fetch(`${baseUrl}/infer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(largePromptEnvelope),
  });
  assert.equal(promptResponse.status, 413);

  const tooManyTokens: InferenceRequest = {
    requestId: 'req-tokens',
    modelId: 'mock-model',
    prompt: 'hi',
    maxTokens: 8,
  };
  const tokensEnvelope = signEnvelope(
    buildEnvelope(tooManyTokens, 'nonce-tokens', Date.now(), routerKeyId),
    routerKeys.privateKey,
  );
  const tokenResponse = await fetch(`${baseUrl}/infer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(tokensEnvelope),
  });
  assert.equal(tokenResponse.status, 400);

  await closeServer(server);
});

test('node /infer enforces max request bytes', async () => {
  const nodeKeys = generateKeyPairSync('ed25519');
  const routerKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyNpub(routerKeys.publicKey);
  const nodeKeyId = exportPublicKeyNpub(nodeKeys.publicKey);

  const config: NodeConfig = {
    nodeId: 'node-1',
    keyId: nodeKeyId,
    endpoint: 'http://localhost:0',
    routerEndpoint: 'http://localhost:8080',
    heartbeatIntervalMs: 10_000,
    runnerName: 'mock',
    port: 0,
    capacityMaxConcurrent: 4,
    capacityCurrentLoad: 0,
    maxRequestBytes: 32,
    requirePayment: false,
    privateKey: nodeKeys.privateKey,
    routerPublicKey: routerKeys.publicKey,
  };

  const { server, baseUrl } = await startServer(config);
  const payload: InferenceRequest = {
    requestId: 'req-body',
    modelId: 'mock-model',
    prompt: 'hello-world',
    maxTokens: 8,
  };

  const requestEnvelope = signEnvelope(
    buildEnvelope(payload, 'nonce-body', Date.now(), routerKeyId),
    routerKeys.privateKey,
  );

  const response = await fetch(`${baseUrl}/infer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestEnvelope),
  });

  assert.equal(response.status, 413);
  await closeServer(server);
});

test('node /infer enforces max runtime budget', async () => {
  const nodeKeys = generateKeyPairSync('ed25519');
  const routerKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyNpub(routerKeys.publicKey);
  const nodeKeyId = exportPublicKeyNpub(nodeKeys.publicKey);

  const config: NodeConfig = {
    nodeId: 'node-1',
    keyId: nodeKeyId,
    endpoint: 'http://localhost:0',
    routerEndpoint: 'http://localhost:8080',
    heartbeatIntervalMs: 10_000,
    runnerName: 'mock',
    port: 0,
    capacityMaxConcurrent: 4,
    capacityCurrentLoad: 0,
    maxInferenceMs: 10,
    requirePayment: false,
    privateKey: nodeKeys.privateKey,
    routerPublicKey: routerKeys.publicKey,
  };

  const slowRunner = {
    listModels: async () => [],
    infer: async () =>
      new Promise<InferenceResponse>((resolve) =>
        setTimeout(
          () =>
            resolve({
              requestId: 'req-timeout',
              modelId: 'mock-model',
              output: 'late',
              usage: { inputTokens: 1, outputTokens: 1 },
              latencyMs: 50,
            }),
          50,
        ),
      ),
    estimate: async () => ({ latencyEstimateMs: 50 }),
    health: async () => ({ ok: true }),
  };

  const { server, baseUrl } = await startServer(config, slowRunner);
  const payload: InferenceRequest = {
    requestId: 'req-timeout',
    modelId: 'mock-model',
    prompt: 'hello',
    maxTokens: 8,
  };

  const requestEnvelope = signEnvelope(
    buildEnvelope(payload, 'nonce-timeout', Date.now(), routerKeyId),
    routerKeys.privateKey,
  );

  const response = await fetch(`${baseUrl}/infer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestEnvelope),
  });

  assert.equal(response.status, 504);
  await closeServer(server);
});

test('node /metrics exposes Prometheus metrics', async () => {
  const nodeKeys = generateKeyPairSync('ed25519');
  const config: NodeConfig = {
    nodeId: 'node-1',
    keyId: exportPublicKeyNpub(nodeKeys.publicKey),
    endpoint: 'http://localhost:0',
    routerEndpoint: 'http://localhost:8080',
    heartbeatIntervalMs: 10_000,
    runnerName: 'mock',
    port: 0,
    capacityMaxConcurrent: 4,
    capacityCurrentLoad: 0,
    requirePayment: false,
    privateKey: nodeKeys.privateKey,
    routerPublicKey: nodeKeys.publicKey,
  };

  const { server, baseUrl } = await startServer(config);
  const response = await fetch(`${baseUrl}/metrics`);
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.ok(body.includes('node_inference_requests_total'));
  await closeServer(server);
});
