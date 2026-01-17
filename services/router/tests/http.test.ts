import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { createHash, generateKeyPairSync, KeyObject } from 'node:crypto';
import {
  buildEnvelope,
  exportPublicKeyHex,
  signEnvelope,
  signRouterMessage,
  signRouterReceipt,
  validateEnvelope,
  validateInferenceResponse,
  validateMeteringRecord,
  validatePaymentRequest,
  validateQuoteResponse,
  validateStakeCommit,
  verifyRouterMessage,
  verifyEnvelope,
} from '@fed-ai/protocol';
import {
  publishAward,
  publishFederation,
  runFederationAuction,
  runAuctionAndAward,
  selectAwardFromBids,
} from '../src/federation/publisher';
import { discoverFederationPeers } from '../src/federation/discovery';
import { signManifest } from '@fed-ai/manifest';
import { createRouterService } from '../src/server';
import { createRouterHttpServer } from '../src/http';
import type {
  Envelope,
  InferenceRequest,
  NodeDescriptor,
  MeteringRecord,
  InferenceResponse,
  PaymentReceipt,
  PaymentRequest,
  QuoteRequest,
  QuoteResponse,
  StakeCommit,
  RouterCapabilityProfile,
  RouterControlMessage,
  RouterJobResult,
  RouterJobSubmit,
  RouterReceipt,
} from '@fed-ai/protocol';
import type { NodeManifest, RelayDiscoverySnapshot } from '@fed-ai/manifest';
import type { RouterConfig } from '../src/config';

const startRouter = async (config: RouterConfig) => {
  const service = createRouterService(config);
  const server = createRouterHttpServer(service, config);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
};

const startStubNode = async (
  nodeKeyId: string,
  privateKey: KeyObject,
  nodeId = 'node-1',
  output = 'ok',
) => {
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
        output,
        usage: { inputTokens: 1, outputTokens: 1 },
        latencyMs: 5,
      };

      const meteringPayload: MeteringRecord = {
        requestId: body.payload.requestId,
        nodeId,
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

  await Promise.all([
    new Promise<void>((resolve) => routerServer.close(() => resolve())),
    new Promise<void>((resolve) => nodeServer.close(() => resolve())),
  ]);
});

test('router /infer falls back to another node on failure', async () => {
  const routerKeys = generateKeyPairSync('ed25519');
  const nodeAKeys = generateKeyPairSync('ed25519');
  const nodeBKeys = generateKeyPairSync('ed25519');
  const clientKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyHex(routerKeys.publicKey);
  const nodeAKeyId = exportPublicKeyHex(nodeAKeys.publicKey);
  const nodeBKeyId = exportPublicKeyHex(nodeBKeys.publicKey);
  const clientKeyId = exportPublicKeyHex(clientKeys.publicKey);

  const failingServer = http.createServer((_req, res) => {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'boom' }));
  });
  await new Promise<void>((resolve) => failingServer.listen(0, resolve));
  const failingAddress = failingServer.address() as AddressInfo;
  const failingUrl = `http://127.0.0.1:${failingAddress.port}`;

  const { server: nodeBServer, baseUrl: nodeBUrl } = await startStubNode(
    nodeBKeyId,
    nodeBKeys.privateKey,
    'node-b',
    'ok-b',
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

  const nodeADescriptor: NodeDescriptor = {
    nodeId: 'node-a',
    keyId: nodeAKeyId,
    endpoint: failingUrl,
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

  const nodeBDescriptor: NodeDescriptor = {
    nodeId: 'node-b',
    keyId: nodeBKeyId,
    endpoint: nodeBUrl,
    capacity: { maxConcurrent: 10, currentLoad: 0 },
    capabilities: [
      {
        modelId: 'mock-model',
        contextWindow: 4096,
        maxTokens: 1024,
        pricing: { unit: 'token', inputRate: 1, outputRate: 1, currency: 'USD' },
      },
    ],
  };

  const registerNode = async (descriptor: NodeDescriptor, keyId: string, privateKey: KeyObject) => {
    const envelope = signEnvelope(
      buildEnvelope(descriptor, `nonce-${descriptor.nodeId}`, Date.now(), keyId),
      privateKey,
    );
    await fetch(`${routerUrl}/register-node`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    });
  };

  await registerNode(nodeADescriptor, nodeAKeyId, nodeAKeys.privateKey);
  await registerNode(nodeBDescriptor, nodeBKeyId, nodeBKeys.privateKey);

  const request: InferenceRequest = {
    requestId: 'req-fallback',
    modelId: 'mock-model',
    prompt: 'hello',
    maxTokens: 8,
  };

  const requestEnvelope = signEnvelope(
    buildEnvelope(request, 'nonce-fallback', Date.now(), clientKeyId),
    clientKeys.privateKey,
  );

  const response = await fetch(`${routerUrl}/infer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestEnvelope),
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as { response: Envelope<InferenceResponse> };
  assert.equal(body.response.payload.output, 'ok-b');

  await Promise.all([
    new Promise<void>((resolve) => routerServer.close(() => resolve())),
    new Promise<void>((resolve) => failingServer.close(() => resolve())),
    new Promise<void>((resolve) => nodeBServer.close(() => resolve())),
  ]);
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
    const paymentEnvelope = paymentBody.payment as Envelope<PaymentRequest>;
    assert.equal(paymentEnvelope.payload.requestId, clientRequest.requestId);
    assert.equal(paymentEnvelope.payload.payeeType, 'node');
    assert.equal(paymentEnvelope.payload.payeeId, nodeDescriptor.nodeId);

    const receipt: PaymentReceipt = {
      requestId: paymentEnvelope.payload.requestId,
      payeeType: paymentEnvelope.payload.payeeType,
      payeeId: paymentEnvelope.payload.payeeId,
      amountSats: paymentEnvelope.payload.amountSats,
      paidAtMs: Date.now(),
      invoice: paymentEnvelope.payload.invoice,
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

test('router /manifest influences selection weight', async () => {
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
  const nodeA: NodeDescriptor = {
    nodeId: 'node-a',
    keyId: nodeKeyId,
    endpoint: 'http://localhost:9999',
    capacity: { maxConcurrent: 10, currentLoad: 0 },
    capabilities: [
      {
        modelId: 'mock-model',
        contextWindow: 4096,
        maxTokens: 1024,
        pricing: { unit: 'token', inputRate: 0.01, outputRate: 0.01, currency: 'USD' },
      },
    ],
  };
  const nodeB: NodeDescriptor = {
    nodeId: 'node-b',
    keyId: nodeKeyId,
    endpoint: 'http://localhost:9998',
    capacity: { maxConcurrent: 10, currentLoad: 0 },
    capabilities: [
      {
        modelId: 'mock-model',
        contextWindow: 4096,
        maxTokens: 1024,
        pricing: { unit: 'token', inputRate: 0.01, outputRate: 0.01, currency: 'USD' },
      },
    ],
  };
  service.nodes.push(nodeA, nodeB);

  const manifest: NodeManifest = {
    id: 'node-a',
    role_types: ['prepost_node'],
    capability_bands: {
      cpu: 'cpu_high',
      ram: 'ram_64_plus',
      disk: 'disk_ssd',
      net: 'net_good',
      gpu: 'gpu_none',
    },
    limits: { max_concurrency: 2, max_payload_bytes: 1024, max_tokens: 256 },
    supported_formats: ['text'],
    pricing_defaults: { unit: 'token', input_rate: 0, output_rate: 0, currency: 'USD' },
    benchmarks: null,
    software_version: '0.0.1',
  };

  const signedManifest = signManifest(manifest, nodeKeyId, nodeKeys.privateKey) as NodeManifest;

  const server = createRouterHttpServer(service, config);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const quoteRequest: QuoteRequest = {
    requestId: 'req-manifest',
    modelId: 'mock-model',
    maxTokens: 32,
    inputTokensEstimate: 10,
    outputTokensEstimate: 5,
  };

  const requestEnvelope = signEnvelope(
    buildEnvelope(quoteRequest, 'nonce-manifest', Date.now(), clientKeyId),
    clientKeys.privateKey,
  );

  const manifestResponse = await fetch(`${baseUrl}/manifest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(signedManifest),
  });

  assert.equal(manifestResponse.status, 200);

  const response = await fetch(`${baseUrl}/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestEnvelope),
  });

  const body = (await response.json()) as { quote: Envelope<QuoteResponse> };
  assert.equal(body.quote.payload.nodeId, 'node-a');

  server.close();
});

test('router /stake/commit records stake and affects selection', async () => {
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
  const nodeA: NodeDescriptor = {
    nodeId: nodeKeyId,
    keyId: nodeKeyId,
    endpoint: 'http://localhost:9997',
    capacity: { maxConcurrent: 10, currentLoad: 0 },
    capabilities: [
      {
        modelId: 'mock-model',
        contextWindow: 4096,
        maxTokens: 1024,
        pricing: { unit: 'token', inputRate: 0.01, outputRate: 0.01, currency: 'USD' },
      },
    ],
  };
  const nodeB: NodeDescriptor = {
    nodeId: 'node-b',
    keyId: nodeKeyId,
    endpoint: 'http://localhost:9996',
    capacity: { maxConcurrent: 10, currentLoad: 0 },
    capabilities: [
      {
        modelId: 'mock-model',
        contextWindow: 4096,
        maxTokens: 1024,
        pricing: { unit: 'token', inputRate: 0.01, outputRate: 0.01, currency: 'USD' },
      },
    ],
  };
  service.nodes.push(nodeA, nodeB);

  const server = createRouterHttpServer(service, config);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const stakeCommit: StakeCommit = {
    stakeId: 'stake-1',
    actorId: nodeKeyId,
    actorType: 'node',
    units: 2000,
    committedAtMs: Date.now(),
    expiresAtMs: Date.now() + 60_000,
  };

  const stakeEnvelope = signEnvelope(
    buildEnvelope(stakeCommit, 'nonce-stake', Date.now(), nodeKeyId),
    nodeKeys.privateKey,
  );

  const stakeResponse = await fetch(`${baseUrl}/stake/commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(stakeEnvelope),
  });

  assert.equal(stakeResponse.status, 200);
  const stakeBody = (await stakeResponse.json()) as { ok: boolean };
  assert.equal(stakeBody.ok, true);
  const stakeValidation = validateEnvelope(stakeEnvelope, validateStakeCommit);
  assert.equal(stakeValidation.ok, true);

  const quoteRequest: QuoteRequest = {
    requestId: 'req-stake',
    modelId: 'mock-model',
    maxTokens: 32,
    inputTokensEstimate: 10,
    outputTokensEstimate: 5,
  };

  const requestEnvelope = signEnvelope(
    buildEnvelope(quoteRequest, 'nonce-stake-quote', Date.now(), clientKeyId),
    clientKeys.privateKey,
  );

  const response = await fetch(`${baseUrl}/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestEnvelope),
  });

  const body = (await response.json()) as { quote: Envelope<QuoteResponse> };
  assert.equal(body.quote.payload.nodeId, nodeKeyId);

  server.close();
});

test('router /manifest requires relay snapshot for promotion when configured', async () => {
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
    relayAdmission: {
      requireSnapshot: true,
      maxAgeMs: 60_000,
      minScore: 1,
      maxResults: 2,
    },
  };

  const service = createRouterService(config);
  const nodeA: NodeDescriptor = {
    nodeId: 'node-a',
    keyId: nodeKeyId,
    endpoint: 'http://localhost:9999',
    capacity: { maxConcurrent: 10, currentLoad: 0 },
    capabilities: [
      {
        modelId: 'mock-model',
        contextWindow: 4096,
        maxTokens: 1024,
        pricing: { unit: 'token', inputRate: 0.02, outputRate: 0.02, currency: 'USD' },
      },
    ],
  };
  const nodeB: NodeDescriptor = {
    nodeId: 'node-b',
    keyId: nodeKeyId,
    endpoint: 'http://localhost:9998',
    capacity: { maxConcurrent: 10, currentLoad: 0 },
    capabilities: [
      {
        modelId: 'mock-model',
        contextWindow: 4096,
        maxTokens: 1024,
        pricing: { unit: 'token', inputRate: 0.01, outputRate: 0.01, currency: 'USD' },
      },
    ],
  };
  service.nodes.push(nodeA, nodeB);

  const manifest: NodeManifest = {
    id: 'node-a',
    role_types: ['prepost_node'],
    capability_bands: {
      cpu: 'cpu_high',
      ram: 'ram_64_plus',
      disk: 'disk_ssd',
      net: 'net_good',
      gpu: 'gpu_none',
    },
    limits: { max_concurrency: 2, max_payload_bytes: 1024, max_tokens: 256 },
    supported_formats: ['text'],
    pricing_defaults: { unit: 'token', input_rate: 0, output_rate: 0, currency: 'USD' },
    benchmarks: null,
    software_version: '0.0.1',
  };

  const server = createRouterHttpServer(service, config);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const quoteRequest: QuoteRequest = {
    requestId: 'req-manifest-policy',
    modelId: 'mock-model',
    maxTokens: 32,
    inputTokensEstimate: 10,
    outputTokensEstimate: 5,
  };

  const buildQuoteEnvelope = (nonce: string) =>
    signEnvelope(buildEnvelope(quoteRequest, nonce, Date.now(), clientKeyId), clientKeys.privateKey);

  const signedManifest = signManifest(manifest, nodeKeyId, nodeKeys.privateKey) as NodeManifest;
  await fetch(`${baseUrl}/manifest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(signedManifest),
  });

  const requestEnvelope = buildQuoteEnvelope('nonce-manifest-policy-1');
  const responseWithoutSnapshot = await fetch(`${baseUrl}/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestEnvelope),
  });
  const bodyWithoutSnapshot = (await responseWithoutSnapshot.json()) as { quote: Envelope<QuoteResponse> };
  assert.equal(bodyWithoutSnapshot.quote.payload.nodeId, 'node-b');

  const relaySnapshot: RelayDiscoverySnapshot = {
    discoveredAtMs: Date.now(),
    relays: [
      {
        url: 'wss://relay.example',
        read: true,
        write: true,
        priority: 3,
        score: 2,
        tags: [],
        lastSeenMs: Date.now(),
      },
    ],
    options: {
      minScore: 1,
      maxResults: 2,
    },
  };

  const promotedManifest = signManifest(
    { ...manifest, relay_discovery: relaySnapshot },
    nodeKeyId,
    nodeKeys.privateKey,
  ) as NodeManifest;

  await fetch(`${baseUrl}/manifest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(promotedManifest),
  });

  const requestEnvelopeWithSnapshot = buildQuoteEnvelope('nonce-manifest-policy-2');
  const responseWithSnapshot = await fetch(`${baseUrl}/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestEnvelopeWithSnapshot),
  });
  const bodyWithSnapshot = (await responseWithSnapshot.json()) as { quote: Envelope<QuoteResponse> };
  assert.equal(bodyWithSnapshot.quote.payload.nodeId, 'node-a');

  server.close();
});

test('router manifest trust decays as observed performance accumulates', async () => {
  const routerKeys = generateKeyPairSync('ed25519');
  const clientKeys = generateKeyPairSync('ed25519');
  const nodeAKeys = generateKeyPairSync('ed25519');
  const nodeBKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyHex(routerKeys.publicKey);
  const clientKeyId = exportPublicKeyHex(clientKeys.publicKey);
  const nodeAKeyId = exportPublicKeyHex(nodeAKeys.publicKey);
  const nodeBKeyId = exportPublicKeyHex(nodeBKeys.publicKey);

  const { server: nodeAServer, baseUrl: nodeAUrl } = await startStubNode(
    nodeAKeyId,
    nodeAKeys.privateKey,
    'node-a',
  );
  const { server: nodeBServer, baseUrl: nodeBUrl } = await startStubNode(
    nodeBKeyId,
    nodeBKeys.privateKey,
    'node-b',
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

  const baseCapabilities = (inputRate: number, outputRate: number) => [
    {
      modelId: 'mock-model',
      contextWindow: 4096,
      maxTokens: 1024,
      pricing: { unit: 'token', inputRate, outputRate, currency: 'USD' },
    },
  ];

  const nodeADescriptor: NodeDescriptor = {
    nodeId: 'node-a',
    keyId: nodeAKeyId,
    endpoint: nodeAUrl,
    capacity: { maxConcurrent: 10, currentLoad: 0 },
    capabilities: baseCapabilities(0.05, 0.05),
  };
  const nodeBCheap: NodeDescriptor = {
    nodeId: 'node-b',
    keyId: nodeBKeyId,
    endpoint: nodeBUrl,
    capacity: { maxConcurrent: 10, currentLoad: 0 },
    capabilities: baseCapabilities(0.005, 0.005),
  };
  const nodeBExpensive: NodeDescriptor = {
    ...nodeBCheap,
    capabilities: baseCapabilities(0.5, 0.5),
  };

  const registerNode = async (descriptor: NodeDescriptor, keyId: string, privateKey: KeyObject) => {
    const envelope = signEnvelope(
      buildEnvelope(descriptor, `nonce-${descriptor.nodeId}-${Date.now()}`, Date.now(), keyId),
      privateKey,
    );
    await fetch(`${routerUrl}/register-node`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    });
  };

  try {
    await registerNode(nodeADescriptor, nodeAKeyId, nodeAKeys.privateKey);
    await registerNode(nodeBCheap, nodeBKeyId, nodeBKeys.privateKey);

    const manifest: NodeManifest = {
      id: 'node-a',
      role_types: ['prepost_node'],
      capability_bands: {
        cpu: 'cpu_high',
        ram: 'ram_64_plus',
        disk: 'disk_ssd',
        net: 'net_good',
        gpu: 'gpu_none',
      },
      limits: { max_concurrency: 2, max_payload_bytes: 1024, max_tokens: 256 },
      supported_formats: ['text'],
      pricing_defaults: { unit: 'token', input_rate: 0, output_rate: 0, currency: 'USD' },
      benchmarks: null,
      software_version: '0.0.1',
    };
    const signedManifest = signManifest(manifest, nodeAKeyId, nodeAKeys.privateKey) as NodeManifest;
    await fetch(`${routerUrl}/manifest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(signedManifest),
    });

    const quoteRequest: QuoteRequest = {
      requestId: 'req-manifest-decay',
      modelId: 'mock-model',
      maxTokens: 32,
      inputTokensEstimate: 10,
      outputTokensEstimate: 5,
    };
    const buildQuoteEnvelope = (nonce: string) =>
      signEnvelope(buildEnvelope(quoteRequest, nonce, Date.now(), clientKeyId), clientKeys.privateKey);

    const initialQuote = await fetch(`${routerUrl}/quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildQuoteEnvelope('nonce-decay-1')),
    });
    const initialBody = (await initialQuote.json()) as { quote: Envelope<QuoteResponse> };
    assert.equal(initialBody.quote.payload.nodeId, 'node-a');

    await registerNode(nodeBExpensive, nodeBKeyId, nodeBKeys.privateKey);
    for (let i = 0; i < 20; i += 1) {
      const inferRequest: InferenceRequest = {
        requestId: `req-decay-${i}`,
        modelId: 'mock-model',
        prompt: 'hello',
        maxTokens: 8,
      };
      const inferEnvelope = signEnvelope(
        buildEnvelope(inferRequest, `nonce-decay-infer-${i}`, Date.now(), clientKeyId),
        clientKeys.privateKey,
      );
      const response = await fetch(`${routerUrl}/infer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(inferEnvelope),
      });
      assert.equal(response.status, 200);
    }

    await registerNode(nodeBCheap, nodeBKeyId, nodeBKeys.privateKey);
    const finalQuote = await fetch(`${routerUrl}/quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildQuoteEnvelope('nonce-decay-2')),
    });
    const finalBody = (await finalQuote.json()) as { quote: Envelope<QuoteResponse> };
    assert.equal(finalBody.quote.payload.nodeId, 'node-b');
  } finally {
    await Promise.all([
      new Promise<void>((resolve) => routerServer.close(() => resolve())),
      new Promise<void>((resolve) => nodeAServer.close(() => resolve())),
      new Promise<void>((resolve) => nodeBServer.close(() => resolve())),
    ]);
  }
});

test('router /metrics exposes Prometheus metrics', async () => {
  const routerKeys = generateKeyPairSync('ed25519');
  const config: RouterConfig = {
    routerId: 'router-1',
    keyId: exportPublicKeyHex(routerKeys.publicKey),
    endpoint: 'http://localhost:0',
    port: 0,
    privateKey: routerKeys.privateKey,
    requirePayment: false,
  };

  const { server, baseUrl } = await startRouter(config);
  const metricsResponse = await fetch(`${baseUrl}/metrics`);
  assert.equal(metricsResponse.status, 200);
  const body = await metricsResponse.text();
  assert.ok(body.includes('router_inference_requests_total'));
  server.close();
});

test('router cools down nodes after repeated failures', async () => {
  const routerKeys = generateKeyPairSync('ed25519');
  const nodeKeys = generateKeyPairSync('ed25519');
  const clientKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyHex(routerKeys.publicKey);
  const nodeKeyId = exportPublicKeyHex(nodeKeys.publicKey);
  const clientKeyId = exportPublicKeyHex(clientKeys.publicKey);

  const config: RouterConfig = {
    routerId: 'router-1',
    keyId: routerKeyId,
    endpoint: 'http://localhost:0',
    port: 0,
    privateKey: routerKeys.privateKey,
    requirePayment: false,
  };

  let calls = 0;
  const failureThreshold = 3;
  const nodeServer = http.createServer(async (req, res) => {
    calls += 1;
    const status = calls <= failureThreshold ? 500 : 200;
    res.writeHead(status, { 'content-type': 'application/json' });
    if (status === 500) {
      res.end(JSON.stringify({ error: 'boom' }));
      return;
    }
    const nodeResponse = {
      response: {
        payload: { requestId: 'req', modelId: 'mock', output: 'ok', usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 5 },
        nonce: 'nonce',
        ts: Date.now(),
        keyId: nodeKeyId,
        sig: 'sig',
      },
      metering: {
        payload: {
          requestId: 'req',
          nodeId: 'node-1',
          modelId: 'mock',
          promptHash: 'hash',
          inputTokens: 1,
          outputTokens: 1,
          wallTimeMs: 5,
          bytesIn: 1,
          bytesOut: 1,
          ts: Date.now(),
        },
        nonce: 'nonce-meter',
        ts: Date.now(),
        keyId: nodeKeyId,
        sig: 'sig',
      },
    };
    res.end(JSON.stringify(nodeResponse));
  });
  await new Promise<void>((resolve) => nodeServer.listen(0, resolve));
  const nodeAddress = nodeServer.address() as AddressInfo;
  const nodeUrl = `http://127.0.0.1:${nodeAddress.port}`;

  const { server: routerServer, baseUrl: routerUrl } = await startRouter(config);

  const nodeDescriptor: NodeDescriptor = {
    nodeId: 'node-1',
    keyId: nodeKeyId,
    endpoint: nodeUrl,
    capacity: { maxConcurrent: 1, currentLoad: 0 },
    capabilities: [
      {
        modelId: 'mock-model',
        contextWindow: 4096,
        maxTokens: 1024,
        pricing: { unit: 'token', inputRate: 1, outputRate: 1, currency: 'SAT' },
      },
    ],
  };

  const registerEnvelope = signEnvelope(
    buildEnvelope(nodeDescriptor, 'nonce-node', Date.now(), nodeKeyId),
    nodeKeys.privateKey,
  );

  await fetch(`${routerUrl}/register-node`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(registerEnvelope),
  });

  const request: InferenceRequest = {
    requestId: 'req1',
    modelId: 'mock-model',
    prompt: 'hello',
    maxTokens: 8,
  };

  const envelope = signEnvelope(buildEnvelope(request, 'nonce-client', Date.now(), clientKeyId), clientKeys.privateKey);
  for (let i = 0; i < failureThreshold; i += 1) {
    const failureRequest = signEnvelope(
      buildEnvelope({ ...request, requestId: `req${i}` }, `nonce-client-${i}`, Date.now(), clientKeyId),
      clientKeys.privateKey,
    );
    const response = await fetch(`${routerUrl}/infer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(failureRequest),
    });
    assert.equal(response.status, 502);
  }

  const cooldownEnvelope = signEnvelope(
    buildEnvelope({ ...request, requestId: 'req-final' }, 'nonce-client-final', Date.now(), clientKeyId),
    clientKeys.privateKey,
  );
  const cooldownResponse = await fetch(`${routerUrl}/infer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cooldownEnvelope),
  });
  assert.equal(cooldownResponse.status, 503);
  const bodyText = await cooldownResponse.text();
  const body = JSON.parse(bodyText);
  assert.ok(body.error === 'no-nodes' || body.error === 'no-nodes-available');

  routerServer.close();
  nodeServer.close();
});

test('router federation caps endpoint accepts signed message', async () => {
  const routerKeys = generateKeyPairSync('ed25519');
  const peerKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyHex(routerKeys.publicKey);
  const peerKeyId = exportPublicKeyHex(peerKeys.publicKey);

  const config: RouterConfig = {
    routerId: 'router-1',
    keyId: routerKeyId,
    endpoint: 'http://localhost:0',
    port: 0,
    privateKey: routerKeys.privateKey,
    requirePayment: false,
    federation: {
      enabled: true,
      endpoint: 'http://localhost:0',
    },
  };

  const { server, baseUrl } = await startRouter(config);

  const caps: RouterCapabilityProfile = {
    routerId: peerKeyId,
    transportEndpoints: ['http://peer-router:8080'],
    supportedJobTypes: ['GEN_CHUNK'],
    resourceLimits: { maxPayloadBytes: 1024, maxTokens: 256, maxConcurrency: 2 },
    modelCaps: [{ modelId: 'mock-model' }],
    privacyCaps: { maxLevel: 'PL1' },
    settlementCaps: { methods: ['invoice'], currency: 'SAT' },
    timestamp: Date.now(),
    expiry: Date.now() + 60_000,
  };

  const message: RouterControlMessage<RouterCapabilityProfile> = {
    type: 'CAPS_ANNOUNCE',
    version: '0.1',
    routerId: peerKeyId,
    messageId: 'msg-1',
    timestamp: Date.now(),
    expiry: Date.now() + 60_000,
    payload: caps,
    sig: '',
  };

  const signed = signRouterMessage(message, peerKeys.privateKey);

  const response = await fetch(`${baseUrl}/federation/caps`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(signed),
  });

  assert.equal(response.status, 200);
  server.close();
});

test('router federation job submit/result validates receipt', async () => {
  const routerKeys = generateKeyPairSync('ed25519');
  const workerKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyHex(routerKeys.publicKey);
  const workerKeyId = exportPublicKeyHex(workerKeys.publicKey);

  const config: RouterConfig = {
    routerId: 'router-1',
    keyId: routerKeyId,
    endpoint: 'http://localhost:0',
    port: 0,
    privateKey: routerKeys.privateKey,
    requirePayment: false,
    federation: {
      enabled: true,
      endpoint: 'http://localhost:0',
    },
  };

  const { server, baseUrl } = await startRouter(config);

  const submit: RouterJobSubmit = {
    jobId: 'job-1',
    jobType: 'GEN_CHUNK',
    privacyLevel: 'PL1',
    payload: 'encrypted-payload',
    inputHash: 'input-hash',
    maxCostMsat: 1000,
    maxRuntimeMs: 1000,
    returnEndpoint: 'http://router:8080/federation/job-result',
  };

  const submitResponse = await fetch(`${baseUrl}/federation/job-submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(submit),
  });
  assert.equal(submitResponse.status, 200);

  const receipt: RouterReceipt = {
    jobId: 'job-1',
    requestRouterId: routerKeyId,
    workerRouterId: workerKeyId,
    inputHash: 'input-hash',
    outputHash: 'output-hash',
    usage: { tokens: 10, runtimeMs: 5 },
    priceMsat: 900,
    status: 'OK',
    startedAtMs: Date.now(),
    finishedAtMs: Date.now(),
    receiptId: 'receipt-1',
    sig: '',
  };

  const signedReceipt = signRouterReceipt(receipt, workerKeys.privateKey);

  const result: RouterJobResult = {
    jobId: 'job-1',
    resultPayload: 'encrypted-result',
    outputHash: 'output-hash',
    usage: { tokens: 10, runtimeMs: 5 },
    resultStatus: 'OK',
    receipt: signedReceipt,
  };

  const resultResponse = await fetch(`${baseUrl}/federation/job-result`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(result),
  });

  assert.equal(resultResponse.status, 200);
  server.close();
});

test('router federation self caps returns signed message', async () => {
  const routerKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyHex(routerKeys.publicKey);

  const config: RouterConfig = {
    routerId: 'router-1',
    keyId: routerKeyId,
    endpoint: 'http://localhost:0',
    port: 0,
    privateKey: routerKeys.privateKey,
    requirePayment: false,
    federation: {
      enabled: true,
      endpoint: 'http://localhost:0',
    },
  };

  const { server, baseUrl } = await startRouter(config);

  const caps: RouterCapabilityProfile = {
    routerId: routerKeyId,
    transportEndpoints: ['http://router:8080'],
    supportedJobTypes: ['GEN_CHUNK'],
    resourceLimits: { maxPayloadBytes: 2048, maxTokens: 512, maxConcurrency: 2 },
    modelCaps: [{ modelId: 'mock-model' }],
    privacyCaps: { maxLevel: 'PL1' },
    settlementCaps: { methods: ['invoice'], currency: 'SAT' },
    timestamp: Date.now(),
    expiry: Date.now() + 60_000,
  };

  const response = await fetch(`${baseUrl}/federation/self/caps`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(caps),
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as { message: RouterControlMessage<RouterCapabilityProfile> };
  assert.equal(verifyRouterMessage(body.message, routerKeys.publicKey), true);

  server.close();
});

test('router federation self price returns signed message', async () => {
  const routerKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyHex(routerKeys.publicKey);

  const config: RouterConfig = {
    routerId: 'router-1',
    keyId: routerKeyId,
    endpoint: 'http://localhost:0',
    port: 0,
    privateKey: routerKeys.privateKey,
    requirePayment: false,
    federation: {
      enabled: true,
      endpoint: 'http://localhost:0',
    },
  };

  const { server, baseUrl } = await startRouter(config);

  const priceSheet = {
    routerId: routerKeyId,
    jobType: 'GEN_CHUNK',
    unit: 'PER_1K_TOKENS',
    basePriceMsat: 100,
    currentSurge: 1,
    timestamp: Date.now(),
    expiry: Date.now() + 60_000,
  };

  const response = await fetch(`${baseUrl}/federation/self/price`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(priceSheet),
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as { message: RouterControlMessage<typeof priceSheet> };
  assert.equal(verifyRouterMessage(body.message, routerKeys.publicKey), true);

  server.close();
});

test('router federation self status returns signed message', async () => {
  const routerKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyHex(routerKeys.publicKey);

  const config: RouterConfig = {
    routerId: 'router-1',
    keyId: routerKeyId,
    endpoint: 'http://localhost:0',
    port: 0,
    privateKey: routerKeys.privateKey,
    requirePayment: false,
    federation: {
      enabled: true,
      endpoint: 'http://localhost:0',
    },
  };

  const { server, baseUrl } = await startRouter(config);

  const status = {
    routerId: routerKeyId,
    loadSummary: {
      queueDepth: 0,
      p95LatencyMs: 50,
      cpuPct: 10,
      ramPct: 20,
      activeJobs: 0,
      backpressureState: 'NORMAL',
    },
    timestamp: Date.now(),
    expiry: Date.now() + 60_000,
  };

  const response = await fetch(`${baseUrl}/federation/self/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(status),
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as { message: RouterControlMessage<typeof status> };
  assert.equal(verifyRouterMessage(body.message, routerKeys.publicKey), true);

  server.close();
});

test('publishFederation posts signed messages to peers', async () => {
  const routerKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyHex(routerKeys.publicKey);

  const config: RouterConfig = {
    routerId: 'router-1',
    keyId: routerKeyId,
    endpoint: 'http://localhost:0',
    port: 0,
    privateKey: routerKeys.privateKey,
    requirePayment: false,
    federation: {
      enabled: true,
      endpoint: 'http://localhost:0',
      peers: ['http://peer.local'],
    },
  };

  const service = createRouterService(config);
  service.federation.localCapabilities = {
    routerId: routerKeyId,
    transportEndpoints: ['http://router:8080'],
    supportedJobTypes: ['GEN_CHUNK'],
    resourceLimits: { maxPayloadBytes: 2048, maxTokens: 512, maxConcurrency: 2 },
    modelCaps: [{ modelId: 'mock-model' }],
    privacyCaps: { maxLevel: 'PL1' },
    settlementCaps: { methods: ['invoice'], currency: 'SAT' },
    timestamp: Date.now(),
    expiry: Date.now() + 60_000,
  };
  service.federation.localStatus = {
    routerId: routerKeyId,
    loadSummary: {
      queueDepth: 0,
      p95LatencyMs: 50,
      cpuPct: 10,
      ramPct: 20,
      activeJobs: 0,
      backpressureState: 'NORMAL',
    },
    timestamp: Date.now(),
    expiry: Date.now() + 60_000,
  };
  service.federation.localPriceSheets.set('GEN_CHUNK', {
    routerId: routerKeyId,
    jobType: 'GEN_CHUNK',
    unit: 'PER_1K_TOKENS',
    basePriceMsat: 100,
    currentSurge: 1,
    timestamp: Date.now(),
    expiry: Date.now() + 60_000,
  });

  const calls: Array<{ url: string; message: RouterControlMessage<unknown> }> = [];
  const fetcher = async (url: string, init?: { body?: unknown }) => {
    calls.push({ url, message: JSON.parse(String(init?.body)) as RouterControlMessage<unknown> });
    return new Response(null, { status: 200 });
  };

  const results = await publishFederation(service, config, ['http://peer.local'], fetcher);
  assert.equal(results.length, 3);
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(verifyRouterMessage(call.message, routerKeys.publicKey), true);
  }
});

test('discoverFederationPeers deduplicates and normalizes', () => {
  const peers = discoverFederationPeers(
    ['http://peer.local/', 'http://peer.local'],
    ['http://bootstrap.local/'],
  );
  assert.equal(peers.length, 2);
  assert.equal(peers[0].url, 'http://peer.local');
  assert.equal(peers[1].url, 'http://bootstrap.local');
});

test('runFederationAuction collects bid responses', async () => {
  const routerKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyHex(routerKeys.publicKey);

  const config: RouterConfig = {
    routerId: 'router-1',
    keyId: routerKeyId,
    endpoint: 'http://localhost:0',
    port: 0,
    privateKey: routerKeys.privateKey,
    requirePayment: false,
    federation: {
      enabled: true,
      endpoint: 'http://localhost:0',
    },
  };

  const rfb: RouterControlMessage<import('@fed-ai/protocol').RouterRfbPayload> = {
    type: 'RFB',
    version: '0.1',
    routerId: routerKeyId,
    messageId: 'rfb-1',
    timestamp: Date.now(),
    expiry: Date.now() + 60_000,
    payload: {
      jobId: 'job-1',
      jobType: 'GEN_CHUNK',
      privacyLevel: 'PL1',
      sizeEstimate: { tokens: 10 },
      deadlineMs: Date.now() + 1000,
      maxPriceMsat: 1000,
      validationMode: 'HASH_ONLY',
      jobHash: 'hash',
    },
    sig: '',
  };

  const fetcher = async () =>
    new Response(
      JSON.stringify({
        bid: {
          type: 'BID',
          version: '0.1',
          routerId: routerKeyId,
          messageId: 'bid-1',
          timestamp: Date.now(),
          expiry: Date.now() + 60_000,
          payload: {
            jobId: 'job-1',
            priceMsat: 900,
            etaMs: 100,
            capacityToken: 'cap',
            bidHash: 'hash',
          },
          sig: 'sig',
        },
      }),
      { status: 200 },
    );

  const result = await runFederationAuction(config, ['http://peer.local'], rfb, fetcher);
  assert.equal(result.bids.length, 1);
  assert.equal(result.jobId, 'job-1');
  assert.equal(result.bids[0].peer, 'http://peer.local');
});

test('publishAward posts award to peer', async () => {
  const routerKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyHex(routerKeys.publicKey);
  const config: RouterConfig = {
    routerId: 'router-1',
    keyId: routerKeyId,
    endpoint: 'http://localhost:0',
    port: 0,
    privateKey: routerKeys.privateKey,
    requirePayment: false,
    federation: {
      enabled: true,
      endpoint: 'http://localhost:0',
    },
  };

  const award: RouterControlMessage<import('@fed-ai/protocol').RouterAwardPayload> = {
    type: 'AWARD',
    version: '0.1',
    routerId: routerKeyId,
    messageId: 'award-1',
    timestamp: Date.now(),
    expiry: Date.now() + 60_000,
    payload: {
      jobId: 'job-1',
      winnerRouterId: 'peer-1',
      acceptedPriceMsat: 1000,
      awardExpiry: Date.now() + 10_000,
      awardHash: 'hash',
    },
    sig: 'sig',
  };

  const fetcher = async (url: string) => new Response(null, { status: url.endsWith('/award') ? 200 : 500 });
  const result = await publishAward(config, 'http://peer.local', award, fetcher);
  assert.equal(result.ok, true);
});

test('selectAwardFromBids builds signed award', async () => {
  const routerKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyHex(routerKeys.publicKey);
  const config: RouterConfig = {
    routerId: 'router-1',
    keyId: routerKeyId,
    endpoint: 'http://localhost:0',
    port: 0,
    privateKey: routerKeys.privateKey,
    requirePayment: false,
    federation: {
      enabled: true,
      endpoint: 'http://localhost:0',
    },
  };

  const rfb: RouterControlMessage<import('@fed-ai/protocol').RouterRfbPayload> = {
    type: 'RFB',
    version: '0.1',
    routerId: routerKeyId,
    messageId: 'rfb-2',
    timestamp: Date.now(),
    expiry: Date.now() + 60_000,
    payload: {
      jobId: 'job-2',
      jobType: 'GEN_CHUNK',
      privacyLevel: 'PL1',
      sizeEstimate: { tokens: 10 },
      deadlineMs: Date.now() + 1000,
      maxPriceMsat: 1000,
      validationMode: 'HASH_ONLY',
      jobHash: 'hash-2',
    },
    sig: '',
  };

  const bids: RouterControlMessage<import('@fed-ai/protocol').RouterBidPayload>[] = [
    {
      type: 'BID',
      version: '0.1',
      routerId: 'peer-1',
      messageId: 'bid-2',
      timestamp: Date.now(),
      expiry: Date.now() + 60_000,
      payload: {
        jobId: 'job-2',
        priceMsat: 900,
        etaMs: 100,
        capacityToken: 'cap',
        bidHash: 'hash-2',
      },
      sig: '',
    },
  ];

  const award = selectAwardFromBids(config, rfb, bids, 'peer-1');
  assert.ok(award);
  assert.equal(verifyRouterMessage(award!, routerKeys.publicKey), true);
});

test('runAuctionAndAward publishes award to winning peer', async () => {
  const routerKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyHex(routerKeys.publicKey);
  const config: RouterConfig = {
    routerId: 'router-1',
    keyId: routerKeyId,
    endpoint: 'http://localhost:0',
    port: 0,
    privateKey: routerKeys.privateKey,
    requirePayment: false,
    federation: {
      enabled: true,
      endpoint: 'http://localhost:0',
    },
  };

  const rfb: RouterControlMessage<import('@fed-ai/protocol').RouterRfbPayload> = {
    type: 'RFB',
    version: '0.1',
    routerId: routerKeyId,
    messageId: 'rfb-3',
    timestamp: Date.now(),
    expiry: Date.now() + 60_000,
    payload: {
      jobId: 'job-3',
      jobType: 'GEN_CHUNK',
      privacyLevel: 'PL1',
      sizeEstimate: { tokens: 10 },
      deadlineMs: Date.now() + 1000,
      maxPriceMsat: 1000,
      validationMode: 'HASH_ONLY',
      jobHash: 'hash-3',
    },
    sig: '',
  };

  let awardPosted = false;
  const fetcher = async (url: string, init?: RequestInit) => {
    if (url.endsWith('/federation/rfb')) {
      return new Response(
        JSON.stringify({
          bid: {
            type: 'BID',
            version: '0.1',
            routerId: 'peer-1',
            messageId: 'bid-3',
            timestamp: Date.now(),
            expiry: Date.now() + 60_000,
            payload: {
              jobId: 'job-3',
              priceMsat: 800,
              etaMs: 90,
              capacityToken: 'cap',
              bidHash: 'hash-3',
            },
            sig: 'sig',
          },
        }),
        { status: 200 },
      );
    }
    if (url.endsWith('/federation/award')) {
      awardPosted = true;
      return new Response(null, { status: 200 });
    }
    return new Response(null, { status: 404 });
  };

  const result = await runAuctionAndAward(config, ['http://peer.local'], rfb, fetcher);
  assert.ok(result.award);
  assert.equal(awardPosted, true);
});

test('router federation payment request returns signed payment request', async () => {
  const routerKeys = generateKeyPairSync('ed25519');
  const workerKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyHex(routerKeys.publicKey);
  const workerKeyId = exportPublicKeyHex(workerKeys.publicKey);

  const config: RouterConfig = {
    routerId: 'router-1',
    keyId: routerKeyId,
    endpoint: 'http://localhost:0',
    port: 0,
    privateKey: routerKeys.privateKey,
    requirePayment: false,
    federation: {
      enabled: true,
      endpoint: 'http://localhost:0',
    },
  };

  const { server, baseUrl } = await startRouter(config);

  const receipt: RouterReceipt = {
    jobId: 'job-2',
    requestRouterId: routerKeyId,
    workerRouterId: workerKeyId,
    inputHash: 'input-hash',
    outputHash: 'output-hash',
    usage: { tokens: 10, runtimeMs: 5 },
    priceMsat: 2000,
    status: 'OK',
    startedAtMs: Date.now(),
    finishedAtMs: Date.now(),
    receiptId: 'receipt-2',
    sig: '',
  };
  const signedReceipt = signRouterReceipt(receipt, workerKeys.privateKey);

  const response = await fetch(`${baseUrl}/federation/payment-request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(signedReceipt),
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as { payment: Envelope<PaymentRequest> };
  const validation = validateEnvelope(body.payment, validatePaymentRequest);
  assert.equal(validation.ok, true);

  server.close();
});

test('router federation payment receipt accepts signed receipt', async () => {
  const routerKeys = generateKeyPairSync('ed25519');
  const workerKeys = generateKeyPairSync('ed25519');
  const clientKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyHex(routerKeys.publicKey);
  const workerKeyId = exportPublicKeyHex(workerKeys.publicKey);
  const clientKeyId = exportPublicKeyHex(clientKeys.publicKey);

  const config: RouterConfig = {
    routerId: 'router-1',
    keyId: routerKeyId,
    endpoint: 'http://localhost:0',
    port: 0,
    privateKey: routerKeys.privateKey,
    requirePayment: false,
    federation: {
      enabled: true,
      endpoint: 'http://localhost:0',
    },
  };

  const { server, baseUrl } = await startRouter(config);

  const receipt: RouterReceipt = {
    jobId: 'job-3',
    requestRouterId: routerKeyId,
    workerRouterId: workerKeyId,
    inputHash: 'input-hash',
    outputHash: 'output-hash',
    usage: { tokens: 10, runtimeMs: 5 },
    priceMsat: 2000,
    status: 'OK',
    startedAtMs: Date.now(),
    finishedAtMs: Date.now(),
    receiptId: 'receipt-3',
    sig: '',
  };
  const signedReceipt = signRouterReceipt(receipt, workerKeys.privateKey);

  const paymentRequestResponse = await fetch(`${baseUrl}/federation/payment-request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(signedReceipt),
  });
  assert.equal(paymentRequestResponse.status, 200);
  const paymentBody = (await paymentRequestResponse.json()) as { payment: Envelope<PaymentRequest> };

  const paymentReceipt: PaymentReceipt = {
    requestId: paymentBody.payment.payload.requestId,
    payeeType: 'router',
    payeeId: paymentBody.payment.payload.payeeId,
    amountSats: paymentBody.payment.payload.amountSats,
    paidAtMs: Date.now(),
    invoice: paymentBody.payment.payload.invoice,
  };
  const signedPaymentReceipt = signEnvelope(
    buildEnvelope(paymentReceipt, 'nonce-pay', Date.now(), clientKeyId),
    clientKeys.privateKey,
  );

  const response = await fetch(`${baseUrl}/federation/payment-receipt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(signedPaymentReceipt),
  });

  assert.equal(response.status, 200);
  server.close();
});

test('router federation settlement tracks request and receipt', async () => {
  const routerKeys = generateKeyPairSync('ed25519');
  const workerKeys = generateKeyPairSync('ed25519');
  const clientKeys = generateKeyPairSync('ed25519');
  const routerKeyId = exportPublicKeyHex(routerKeys.publicKey);
  const workerKeyId = exportPublicKeyHex(workerKeys.publicKey);
  const clientKeyId = exportPublicKeyHex(clientKeys.publicKey);

  const config: RouterConfig = {
    routerId: 'router-1',
    keyId: routerKeyId,
    endpoint: 'http://localhost:0',
    port: 0,
    privateKey: routerKeys.privateKey,
    requirePayment: false,
    federation: {
      enabled: true,
      endpoint: 'http://localhost:0',
    },
  };

  const service = createRouterService(config);
  const server = createRouterHttpServer(service, config);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const jobId = 'job-4';
  service.federation.jobs.set(jobId, {
    submit: {
      jobId,
      jobType: 'GEN_CHUNK',
      privacyLevel: 'PL1',
      payload: 'encrypted-payload',
      inputHash: 'input-hash',
      maxCostMsat: 1000,
      maxRuntimeMs: 1000,
      returnEndpoint: 'http://router:8080/federation/job-result',
    },
    settlement: {},
  });

  const receipt: RouterReceipt = {
    jobId,
    requestRouterId: routerKeyId,
    workerRouterId: workerKeyId,
    inputHash: 'input-hash',
    outputHash: 'output-hash',
    usage: { tokens: 10, runtimeMs: 5 },
    priceMsat: 2000,
    status: 'OK',
    startedAtMs: Date.now(),
    finishedAtMs: Date.now(),
    receiptId: 'receipt-4',
    sig: '',
  };
  const signedReceipt = signRouterReceipt(receipt, workerKeys.privateKey);

  await fetch(`${baseUrl}/federation/payment-request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(signedReceipt),
  });

  const paymentRequest = service.federation.jobs.get(jobId)?.settlement?.paymentRequest;
  assert.ok(paymentRequest);

  const paymentReceipt: PaymentReceipt = {
    requestId: paymentRequest!.requestId,
    payeeType: 'router',
    payeeId: paymentRequest!.payeeId,
    amountSats: paymentRequest!.amountSats,
    paidAtMs: Date.now(),
    invoice: paymentRequest!.invoice,
  };
  const signedPaymentReceipt = signEnvelope(
    buildEnvelope(paymentReceipt, 'nonce-pay-2', Date.now(), clientKeyId),
    clientKeys.privateKey,
  );

  await fetch(`${baseUrl}/federation/payment-receipt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(signedPaymentReceipt),
  });

  const storedReceipt = service.federation.jobs.get(jobId)?.settlement?.paymentReceipt;
  assert.ok(storedReceipt);

  server.close();
});
