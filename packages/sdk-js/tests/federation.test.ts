import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import {
  buildEnvelope,
  exportPrivateKeyHex,
  exportPublicKeyNpub,
  parsePublicKey,
  signEnvelope,
  signRouterMessage,
  signRouterReceipt,
  verifyEnvelope,
  verifyRouterMessage,
  verifyRouterReceipt,
} from '@fed-ai/protocol';
import type {
  Envelope,
  PaymentReceipt,
  PaymentRequest,
  RouterCapabilityProfile,
  RouterControlMessage,
  RouterReceipt,
} from '@fed-ai/protocol';
import { FedAiClient } from '../src';

const buildCapsPayload = (routerId: string): RouterCapabilityProfile => ({
  routerId,
  transportEndpoints: ['http://router'],
  supportedJobTypes: ['GEN_CHUNK'],
  resourceLimits: {
    maxPayloadBytes: 1024,
    maxTokens: 256,
    maxConcurrency: 2,
  },
  modelCaps: [{ modelId: 'model-a', contextWindow: 4096 }],
  privacyCaps: { maxLevel: 'PL1' },
  settlementCaps: { methods: ['ln'], currency: 'SAT' },
  timestamp: Date.now(),
  expiry: Date.now() + 60_000,
});

test('federation helpers send and receive signed messages', async () => {
  const routerPrivate = generateSecretKey();
  const routerPublicHex = getPublicKey(routerPrivate);
  const routerKeyId = exportPublicKeyNpub(Buffer.from(routerPublicHex, 'hex'));

  const clientPrivate = generateSecretKey();
  const clientPublicHex = getPublicKey(clientPrivate);
  const clientKeyId = exportPublicKeyNpub(Buffer.from(clientPublicHex, 'hex'));

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = chunks.length ? Buffer.concat(chunks).toString('utf8') : '';
    if (req.url === '/federation/self/caps') {
      const payload = JSON.parse(body) as RouterCapabilityProfile;
      const message: RouterControlMessage<RouterCapabilityProfile> = {
        type: 'CAPS_ANNOUNCE',
        version: '0.1',
        routerId: routerKeyId,
        messageId: `${payload.routerId}:${payload.timestamp}`,
        timestamp: Date.now(),
        expiry: payload.expiry,
        payload,
        sig: '',
      };
      const signed = signRouterMessage(message, routerPrivate);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: signed }));
      return;
    }
    if (req.url === '/federation/caps') {
      const message = JSON.parse(body) as RouterControlMessage<RouterCapabilityProfile>;
      const publicKey = parsePublicKey(message.routerId);
      assert.equal(verifyRouterMessage(message, publicKey), true);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.url === '/federation/payment-request') {
      const receipt = JSON.parse(body) as RouterReceipt;
      const workerKey = parsePublicKey(receipt.workerRouterId);
      assert.equal(verifyRouterReceipt(receipt, workerKey), true);
      const paymentRequest: PaymentRequest = {
        requestId: receipt.jobId,
        payeeType: 'router',
        payeeId: receipt.workerRouterId,
        amountSats: 1,
        invoice: `lnbc-${receipt.jobId}`,
        expiresAtMs: Date.now() + 60_000,
      };
      const envelope = signEnvelope(
        buildEnvelope(paymentRequest, receipt.jobId, Date.now(), routerKeyId),
        routerPrivate,
      );
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ payment: envelope }));
      return;
    }
    if (req.url === '/federation/payment-receipt') {
      const receiptEnvelope = JSON.parse(body) as Envelope<PaymentReceipt>;
      const clientKey = parsePublicKey(receiptEnvelope.keyId);
      assert.equal(verifyEnvelope(receiptEnvelope, clientKey), true);
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

  const client = new FedAiClient({
    routerUrl: baseUrl,
    keyId: clientKeyId,
    privateKey: exportPrivateKeyHex(clientPrivate),
    routerPublicKey: routerKeyId,
    verifyResponses: true,
  });

  try {
    const capsPayload = buildCapsPayload(routerKeyId);
    const capsMessage = await client.federationSelfCaps(capsPayload);
    assert.equal(capsMessage.payload.routerId, routerKeyId);

    const outgoingMessage = client.createFederationMessage('CAPS_ANNOUNCE', buildCapsPayload(clientKeyId));
    await client.federationCaps(outgoingMessage);

    const receipt = signRouterReceipt(
      {
        jobId: 'job-1',
        requestRouterId: routerKeyId,
        workerRouterId: clientKeyId,
        inputHash: 'in',
        outputHash: 'out',
        usage: { tokens: 1 },
        priceMsat: 1000,
        status: 'OK',
        startedAtMs: Date.now(),
        finishedAtMs: Date.now(),
        receiptId: 'rcpt-1',
        sig: '',
      },
      clientPrivate,
    );
    const payment = await client.federationPaymentRequest(receipt);
    assert.equal(payment.payload.payeeId, clientKeyId);

    const paymentReceipt = client.createPaymentReceipt(payment);
    await client.federationPaymentReceipt(paymentReceipt);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
