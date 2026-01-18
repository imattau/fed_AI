import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { PaymentReceipt } from '@fed-ai/protocol';
import { requestInvoice } from '../src/payments/invoice';
import { verifyPaymentReceipt } from '../src/payments/verify';

const startServer = async (
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
) => {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
};

test('requestInvoice retries with idempotency header', async () => {
  let attempts = 0;
  let lastIdempotency = '';
  const { server, baseUrl } = await startServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/invoice') {
      res.writeHead(404);
      res.end();
      return;
    }
    attempts += 1;
    const header = req.headers['idempotency-key'];
    lastIdempotency = Array.isArray(header) ? header[0] : header ?? '';
    if (attempts === 1) {
      res.writeHead(502);
      res.end('bad');
      return;
    }
    const payload = JSON.stringify({ invoice: 'lnbc-test', paymentHash: 'hash' });
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
    res.end(payload);
  });

  const response = await requestInvoice(
    { requestId: 'req-1', payeeId: 'node-1', amountSats: 10 },
    {
      url: `${baseUrl}/invoice`,
      retryMaxAttempts: 2,
      retryMinDelayMs: 1,
      retryMaxDelayMs: 2,
    },
  );
  server.close();

  assert.equal(response.ok, true);
  assert.equal(attempts, 2);
  assert.equal(lastIdempotency, 'req-1:node-1:10');
});

test('verifyPaymentReceipt retries transient failures', async () => {
  let attempts = 0;
  const { server, baseUrl } = await startServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/verify') {
      res.writeHead(404);
      res.end();
      return;
    }
    attempts += 1;
    if (attempts === 1) {
      res.writeHead(502);
      res.end('bad');
      return;
    }
    const payload = JSON.stringify({ paid: true, settledAtMs: Date.now() });
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
    res.end(payload);
  });

  const receipt: PaymentReceipt = {
    requestId: 'req-2',
    payeeType: 'node',
    payeeId: 'node-1',
    amountSats: 10,
    paidAtMs: Date.now(),
    paymentHash: 'hash',
  };
  const response = await verifyPaymentReceipt(receipt, {
    url: `${baseUrl}/verify`,
    retryMaxAttempts: 2,
    retryMinDelayMs: 1,
    retryMaxDelayMs: 2,
  });
  server.close();

  assert.equal(response.ok, true);
  assert.equal(attempts, 2);
});
