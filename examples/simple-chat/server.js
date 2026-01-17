#!/usr/bin/env node
const http = require('node:http');
const { readFile } = require('node:fs/promises');
const { randomUUID, generateKeyPairSync, sign } = require('node:crypto');
const path = require('node:path');

const routerUrl = process.env.ROUTER_URL ?? 'http://localhost:8080';
const modelId = process.env.MODEL_ID ?? 'tinyllama';
const maxTokens = Number(process.env.MAX_TOKENS ?? 128);
const port = Number(process.env.PORT ?? 3000);

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
      modelId,
      prompt,
      maxTokens,
    };
    const envelope = signEnvelope(request, clientKeyId, clientKeys.privateKey);

    const response = await fetch(`${routerUrl}/infer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    });
    if (!response.ok) {
      const errorText = await response.text();
      res.writeHead(response.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'router-error', details: errorText }));
      return;
    }
    const payload = await response.json();
    const output = payload?.response?.payload?.output ?? '';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ output }));
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(port, () => {
  console.log(`simple chat client running on http://localhost:${port}`);
  console.log(`router: ${routerUrl}`);
});
