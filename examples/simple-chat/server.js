#!/usr/bin/env node
const http = require('node:http');
const { readFile } = require('node:fs/promises');
const { randomUUID, generateKeyPairSync, sign } = require('node:crypto');
const path = require('node:path');

const routerUrl = process.env.ROUTER_URL ?? 'http://localhost:8080';
const defaultModelId = process.env.MODEL_ID ?? 'auto';
const maxTokens = Number(process.env.MAX_TOKENS ?? 128);
const port = Number(process.env.PORT ?? 3000);
const initialWalletSats = Number(process.env.WALLET_SATS ?? 2500);

let walletBalanceSats = Number.isFinite(initialWalletSats) ? initialWalletSats : 0;

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

const exportPublicKeyHex = (key) => {
  const spki = key.export({ format: 'der', type: 'spki' });
  if (!spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
    throw new Error('public key does not match expected Ed25519 DER prefix');
  }
  return spki.subarray(ED25519_SPKI_PREFIX.length).toString('hex');
};

const stableStringify = (value) => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
};

const signEnvelope = (payload, keyId, privateKey) => {
  const envelope = {
    payload,
    nonce: randomUUID(),
    ts: Date.now(),
    keyId,
    sig: '',
  };
  const signingPayload = {
    payload: envelope.payload,
    nonce: envelope.nonce,
    ts: envelope.ts,
    keyId: envelope.keyId,
  };
  const data = Buffer.from(stableStringify(signingPayload), 'utf8');
  const signature = sign(null, data, privateKey);
  envelope.sig = signature.toString('base64');
  return envelope;
};

const clientKeys = generateKeyPairSync('ed25519');
const clientKeyId = exportPublicKeyHex(clientKeys.publicKey);

const serveFile = async (res, filePath, contentType) => {
  const body = await readFile(filePath);
  res.writeHead(200, { 'content-type': contentType });
  res.end(body);
};

const postJson = async (url, body) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response;
};

const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(detail || `request-failed:${response.status}`);
  }
  return response.json();
};

const issuePaymentReceipt = (payment, clientKeyId, clientPrivateKey) => {
  const receipt = {
    requestId: payment.requestId,
    payeeType: payment.payeeType,
    payeeId: payment.payeeId,
    amountSats: payment.amountSats,
    paidAtMs: Date.now(),
    invoice: payment.invoice,
  };
  return signEnvelope(receipt, clientKeyId, clientPrivateKey);
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    return serveFile(res, path.join(__dirname, 'index.html'), 'text/html; charset=utf-8');
  }
  if (req.method === 'GET' && req.url === '/app.js') {
    return serveFile(res, path.join(__dirname, 'app.js'), 'text/javascript; charset=utf-8');
  }
  if (req.method === 'GET' && req.url === '/style.css') {
    return serveFile(res, path.join(__dirname, 'style.css'), 'text/css; charset=utf-8');
  }
  if (req.method === 'GET' && req.url === '/api/wallet') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ sats: walletBalanceSats }));
    return;
  }
  if (req.method === 'GET' && req.url === '/api/router') {
    try {
      const health = await fetchJson(`${routerUrl}/health`);
      const nodes = await fetchJson(`${routerUrl}/nodes`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ health, nodes }));
    } catch (error) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'router-unavailable',
          details: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    return;
  }
  if (req.method === 'GET' && req.url === '/api/nodes') {
    try {
      const nodes = await fetchJson(`${routerUrl}/nodes`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(nodes));
    } catch (error) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'nodes-unavailable',
          details: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/infer') {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks).toString('utf8');
    if (!body) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'empty-body' }));
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid-json' }));
      return;
    }
    const prompt = String(parsed.prompt ?? '');
    if (!prompt) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'missing-prompt' }));
      return;
    }

    const request = {
      requestId: randomUUID(),
      modelId: defaultModelId,
      prompt,
      maxTokens,
    };
    const envelope = signEnvelope(request, clientKeyId, clientKeys.privateKey);

    const response = await postJson(`${routerUrl}/infer`, envelope);
    if (response.status === 402) {
      const payload = await response.json();
      const payment = payload?.payment?.payload;
      if (!payment) {
        res.writeHead(402, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'payment-required', details: payload }));
        return;
      }

      const receiptEnvelope = issuePaymentReceipt(
        payment,
        clientKeyId,
        clientKeys.privateKey,
      );
      if (walletBalanceSats < payment.amountSats) {
        res.writeHead(402, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'insufficient-balance',
            walletSats: walletBalanceSats,
            requiredSats: payment.amountSats,
          }),
        );
        return;
      }
      walletBalanceSats -= payment.amountSats;

      const receiptResponse = await postJson(
        `${routerUrl}/payment-receipt`,
        receiptEnvelope,
      );
      if (!receiptResponse.ok) {
        const errorText = await receiptResponse.text();
        res.writeHead(receiptResponse.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'payment-receipt-rejected', details: errorText }));
        return;
      }

      const retryEnvelope = signEnvelope(request, clientKeyId, clientKeys.privateKey);
      const retryResponse = await postJson(`${routerUrl}/infer`, retryEnvelope);
      if (!retryResponse.ok) {
        const errorText = await retryResponse.text();
        res.writeHead(retryResponse.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'router-error', details: errorText }));
        return;
      }
      const retryPayload = await retryResponse.json();
      const output = retryPayload?.response?.payload?.output ?? '';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ output, walletSats: walletBalanceSats }));
      return;
    }

    if (!response.ok) {
      const errorText = await response.text();
      res.writeHead(response.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'router-error', details: errorText }));
      return;
    }
    const payload = await response.json();
    const output = payload?.response?.payload?.output ?? '';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ output, walletSats: walletBalanceSats }));
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(port, () => {
  console.log(`simple chat client running on http://localhost:${port}`);
  console.log(`router: ${routerUrl}`);
});
