import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { AddressInfo } from 'node:net';
import {
  buildEnvelope,
  exportPublicKeyHex,
  signEnvelope,
  validateEnvelope,
  validateInferenceResponse,
  validateMeteringRecord,
  verifyEnvelope,
} from '@fed-ai/protocol';
import { createNodeService } from '../src/server';
import { createNodeHttpServer } from '../src/http';
import { MockRunner } from '../src/runners/mock';
import type {
  Envelope,
  InferenceRequest,
  InferenceResponse,
  MeteringRecord,
  PaymentReceipt,
} from '@fed-ai/protocol';
import type { NodeConfig } from '../src/config';

const startServer = async (config: NodeConfig) => {
  const service = createNodeService(config, new MockRunner());
  const server = createNodeHttpServer(service, config);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
};

test('node /infer rejects when router public key missing', async () => {
  const { privateKey } = generateKeyPairSync('ed25519');
  const config: NodeConfig = {
    nodeId: 'node-1',
    keyId: 'node-key-1',
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
  const envelope = buildEnvelope(payload, 'nonce-1', Date.now(), 'router-key');
  const response = await fetch(`${baseUrl}/infer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(envelope),
  });

  assert.equal(response.status, 500);

  server.close();
});

test('node /infer validates signatures and returns signed response', async () => {
  const nodeKeys = generateKeyPairSync('ed25519');
  const routerKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyHex(routerKeys.publicKey);
  const nodeKeyId = exportPublicKeyHex(nodeKeys.publicKey);

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

  server.close();
});

test('node /infer requires payment when configured', async () => {
  const nodeKeys = generateKeyPairSync('ed25519');
  const routerKeys = generateKeyPairSync('ed25519');
  const clientKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyHex(routerKeys.publicKey);
  const nodeKeyId = exportPublicKeyHex(nodeKeys.publicKey);
  const clientKeyId = exportPublicKeyHex(clientKeys.publicKey);

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

  server.close();
});

test('node /infer enforces capacity limits', async () => {
  const nodeKeys = generateKeyPairSync('ed25519');
  const routerKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyHex(routerKeys.publicKey);
  const nodeKeyId = exportPublicKeyHex(nodeKeys.publicKey);

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
  server.close();
});

test('node /infer enforces prompt and token limits', async () => {
  const nodeKeys = generateKeyPairSync('ed25519');
  const routerKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyHex(routerKeys.publicKey);
  const nodeKeyId = exportPublicKeyHex(nodeKeys.publicKey);

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

  server.close();
});

test('node /infer enforces max request bytes', async () => {
  const nodeKeys = generateKeyPairSync('ed25519');
  const routerKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyHex(routerKeys.publicKey);
  const nodeKeyId = exportPublicKeyHex(nodeKeys.publicKey);

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
  server.close();
});

test('node /metrics exposes Prometheus metrics', async () => {
  const nodeKeys = generateKeyPairSync('ed25519');
  const config: NodeConfig = {
    nodeId: 'node-1',
    keyId: exportPublicKeyHex(nodeKeys.publicKey),
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
  server.close();
});
