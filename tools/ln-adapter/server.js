#!/usr/bin/env node
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { WebSocket } = require('ws');
const { finalizeEvent, nip04, getPublicKey, generateSecretKey } = require('nostr-tools');

const backend = (process.env.LN_ADAPTER_BACKEND ?? '').toLowerCase();
const port = Number(process.env.LN_ADAPTER_PORT ?? 4000);
const idempotencyTtlMs = Number(process.env.LN_ADAPTER_IDEMPOTENCY_TTL_MS ?? 10 * 60 * 1000);
const idempotencyCache = new Map();

const nwcConfig = (() => {
  const url = process.env.NWC_URL;
  if (!url) return null;
  try {
    const parsed = new URL(url.replace('nostr+walletconnect:', 'http:'));
    return {
      pubkey: parsed.hostname,
      relay: parsed.searchParams.get('relay'),
      secret: parsed.searchParams.get('secret'),
    };
  } catch {
    return null;
  }
})();

const appSecret = generateSecretKey();
const appPubkey = getPublicKey(appSecret);

const callNwc = async (method, params, signal) => {
  if (!nwcConfig) throw new Error('nwc-missing-config');
  
  const ws = new WebSocket(nwcConfig.relay);
  return new Promise(async (resolve, reject) => {
    const cleanup = () => {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
        if (signal) signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => { cleanup(); reject(new Error('timeout')); };
    if (signal) signal.addEventListener('abort', onAbort);

    const requestId = randomBytes(16).toString('hex');
    const req = { id: requestId, method, params };
    const content = await nip04.encrypt(appSecret, nwcConfig.pubkey, JSON.stringify(req));
    
    const event = finalizeEvent({
        kind: 23194,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', nwcConfig.pubkey]],
        content,
    }, appSecret);

    ws.on('open', () => {
        ws.send(JSON.stringify(['EVENT', event]));
        ws.send(JSON.stringify(['REQ', 'nwc', { kinds: [23195], '#p': [appPubkey], authors: [nwcConfig.pubkey], limit: 1 }]));
    });

    ws.on('message', async (data) => {
        const msg = JSON.parse(data.toString());
        if (msg[0] === 'EVENT' && msg[1].kind === 23195) {
            try {
                const dec = await nip04.decrypt(appSecret, msg[1].pubkey, msg[1].content);
                const resp = JSON.parse(dec);
                if (resp.id === requestId) {
                    cleanup();
                    if (resp.error) reject(new Error(resp.error.message || 'nwc-error'));
                    else resolve(resp.result);
                }
            } catch (e) {}
        }
    });

    ws.on('error', (e) => { cleanup(); reject(e); });
    setTimeout(() => { cleanup(); reject(new Error('nwc-timeout')); }, 10000);
  });
};

const jsonResponse = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
};

const readJson = async (req) => {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString('utf8');
  if (!body) {
    return { ok: false, error: 'empty-body' };
  }
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false, error: 'invalid-json' };
  }
};

const readIdempotencyKey = (req) => {
  const header = req.headers['idempotency-key'];
  return Array.isArray(header) ? header[0] : (header || null);
};

const getCachedIdempotency = (key) => {
  const entry = idempotencyCache.get(key);
  if (!entry) return null;
  if (entry.expiresAtMs <= Date.now()) {
    idempotencyCache.delete(key);
    return null;
  }
  return entry;
};

const setCachedIdempotency = (key, status, body) => {
  if (!key || !idempotencyTtlMs || idempotencyTtlMs <= 0) return;
  idempotencyCache.set(key, {
    status,
    body,
    expiresAtMs: Date.now() + idempotencyTtlMs,
  });
};

const lnbitsFetch = async (path, init = {}, signal) => {
  const baseUrl = process.env.LNBITS_URL;
  const apiKey = process.env.LNBITS_API_KEY;
  if (!baseUrl || !apiKey) throw new Error('lnbits-missing-config');
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  const response = await fetch(url, { 
      ...init, 
      headers: { 'content-type': 'application/json', 'X-Api-Key': apiKey, ...(init.headers ?? {}) },
      signal 
  });
  if (!response.ok) throw new Error(`lnbits-${response.status}`);
  return response.json();
};

const lndFetch = async (path, init = {}, signal) => {
  const baseUrl = process.env.LND_REST_URL;
  const macaroon = process.env.LND_MACAROON_HEX;
  if (!baseUrl || !macaroon) throw new Error('lnd-missing-config');
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  const response = await fetch(url, { 
      ...init, 
      headers: { 'content-type': 'application/json', 'Grpc-Metadata-macaroon': macaroon, ...(init.headers ?? {}) },
      signal 
  });
  if (!response.ok) throw new Error(`lnd-${response.status}`);
  return response.json();
};

const handleInvoice = async (payload, signal) => {
  const { requestId, payeeId, amountSats, splits } = payload;
  if (!requestId || !payeeId || !amountSats) {
    return { status: 400, body: { error: 'missing-fields' } };
  }

  if (backend === 'nwc') {
      try {
        const result = await callNwc('make_invoice', { 
            amount: Math.round(Number(amountSats) * 1000), 
            description: `fed-ai:${requestId}:${payeeId}` 
        }, signal);
        return { status: 200, body: { invoice: result.invoice, paymentHash: result.payment_hash, expiresAtMs: Date.now() + 5 * 60 * 1000 } };
      } catch (e) {
        return { status: 502, body: { error: e.message } };
      }
  }

  if (backend === 'lnbits') {
    const response = await lnbitsFetch('/api/v1/payments', {
      method: 'POST',
      body: JSON.stringify({ out: false, amount: Number(amountSats), memo: `fed-ai:${requestId}:${payeeId}` }),
    }, signal);
    return { status: 200, body: { invoice: response.payment_request, paymentHash: response.payment_hash, expiresAtMs: Date.now() + 5 * 60 * 1000 } };
  }

  if (backend === 'lnd') {
    const response = await lndFetch('/v1/invoices', {
      method: 'POST',
      body: JSON.stringify({ value: String(Math.round(Number(amountSats))), memo: `fed-ai:${requestId}:${payeeId}` }),
    }, signal);
    return { status: 200, body: { invoice: response.payment_request, paymentHash: response.r_hash, expiresAtMs: Date.now() + 5 * 60 * 1000 } };
  }

  if (backend === 'mock') {
    return { status: 200, body: { invoice: `lnmock-${requestId}-${Date.now()}`, paymentHash: randomBytes(32).toString('hex'), expiresAtMs: Date.now() + 5 * 60 * 1000 } };
  }

  return { status: 400, body: { error: 'unsupported-backend' } };
};

const handleVerify = async (payload, signal) => {
  const { paymentHash, invoice } = payload;

  if (backend === 'nwc') {
      try {
        const hash = paymentHash;
        if (!hash) return { status: 400, body: { error: 'payment-hash-required' } };
        const result = await callNwc('lookup_invoice', { payment_hash: hash }, signal);
        return { status: 200, body: { paid: !!result.settled_at, settledAtMs: result.settled_at ? result.settled_at * 1000 : null } };
      } catch (e) {
        return { status: 502, body: { error: e.message } };
      }
  }

  if (backend === 'lnbits') {
    let hash = paymentHash;
    if (!hash && invoice) {
      const decoded = await lnbitsFetch('/api/v1/payments/decode', { method: 'POST', body: JSON.stringify({ data: invoice }) }, signal);
      hash = decoded.payment_hash;
    }
    const status = await lnbitsFetch(`/api/v1/payments/${hash}`, { method: 'GET' }, signal);
    return { status: 200, body: { paid: status.paid, settledAtMs: status.paid ? Date.now() : null } };
  }

  if (backend === 'lnd') {
    let hash = paymentHash;
    if (!hash && invoice) {
      const decoded = await lndFetch(`/v1/payreq/${encodeURIComponent(invoice)}`, { method: 'GET' }, signal);
      hash = decoded.payment_hash;
    }
    const hashB64 = Buffer.from(hash, 'hex').toString('base64');
    const response = await lndFetch(`/v1/invoice/${encodeURIComponent(hashB64)}`, { method: 'GET' }, signal);
    return { status: 200, body: { paid: response.settled, settledAtMs: response.settled ? response.settle_date * 1000 : null } };
  }

  if (backend === 'mock') {
    return { status: 200, body: { paid: true, settledAtMs: Date.now() } };
  }

  return { status: 400, body: { error: 'unsupported-backend' } };
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') return jsonResponse(res, 200, { ok: true, backend });

  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'POST' && (url.pathname === '/invoice' || url.pathname === '/verify')) {
    const body = await readJson(req);
    if (!body.ok) return jsonResponse(res, 400, { error: body.error });
    
    const idempotencyKey = readIdempotencyKey(req);
    if (idempotencyKey) {
        const cached = getCachedIdempotency(idempotencyKey);
        if (cached) return jsonResponse(res, cached.status, cached.body);
    }

    try {
      const handler = url.pathname === '/invoice' ? handleInvoice : handleVerify;
      const result = await handler(body.value, null); // Add timeout logic if needed
      if (idempotencyKey) setCachedIdempotency(idempotencyKey, result.status, result.body);
      return jsonResponse(res, result.status, result.body);
    } catch (error) {
      return jsonResponse(res, 502, { error: error.message });
    }
  }

  return jsonResponse(res, 404, { error: 'not-found' });
});

server.listen(port, () => {
  console.log(`ln-adapter running on http://localhost:${port} (backend=${backend || 'none'})`);
});