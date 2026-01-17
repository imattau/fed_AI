#!/usr/bin/env node
const http = require('node:http');

const backend = (process.env.LN_ADAPTER_BACKEND ?? '').toLowerCase();
const port = Number(process.env.LN_ADAPTER_PORT ?? 4000);

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

const hexToBase64 = (value) => {
  if (!value) return null;
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, 'hex').toString('base64');
  }
  return value;
};

const withTimeout = async (fn, timeoutMs) => {
  if (!timeoutMs) {
    return fn(undefined);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
};

const lnbitsFetch = async (path, init = {}, signal) => {
  const baseUrl = process.env.LNBITS_URL;
  const apiKey = process.env.LNBITS_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error('lnbits-missing-config');
  }
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  const headers = {
    'content-type': 'application/json',
    'X-Api-Key': apiKey,
    ...(init.headers ?? {}),
  };
  const response = await fetch(url, { ...init, headers, signal });
  if (!response.ok) {
    throw new Error(`lnbits-${response.status}`);
  }
  return response.json();
};

const lndFetch = async (path, init = {}, signal) => {
  const baseUrl = process.env.LND_REST_URL;
  const macaroon = process.env.LND_MACAROON_HEX;
  if (!baseUrl || !macaroon) {
    throw new Error('lnd-missing-config');
  }
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  const headers = {
    'content-type': 'application/json',
    'Grpc-Metadata-macaroon': macaroon,
    ...(init.headers ?? {}),
  };
  const response = await fetch(url, { ...init, headers, signal });
  if (!response.ok) {
    throw new Error(`lnd-${response.status}`);
  }
  return response.json();
};

const handleInvoice = async (payload, signal) => {
  const { requestId, payeeId, amountSats } = payload;
  if (!requestId || !payeeId || !amountSats) {
    return { status: 400, body: { error: 'missing-fields' } };
  }

  if (backend === 'lnbits') {
    const response = await lnbitsFetch('/api/v1/payments', {
      method: 'POST',
      body: JSON.stringify({
        out: false,
        amount: Number(amountSats),
        memo: `fed-ai:${requestId}:${payeeId}`,
      }),
    }, signal);
    return {
      status: 200,
      body: {
        invoice: response.payment_request,
        paymentHash: response.payment_hash,
        expiresAtMs: Date.now() + 5 * 60 * 1000,
      },
    };
  }

  if (backend === 'lnd') {
    const response = await lndFetch('/v1/invoices', {
      method: 'POST',
      body: JSON.stringify({
        value: String(Math.round(Number(amountSats))),
        memo: `fed-ai:${requestId}:${payeeId}`,
      }),
    }, signal);
    return {
      status: 200,
      body: {
        invoice: response.payment_request,
        paymentHash: response.r_hash,
        expiresAtMs: Date.now() + 5 * 60 * 1000,
      },
    };
  }

  return { status: 400, body: { error: 'unsupported-backend' } };
};

const handleVerify = async (payload, signal) => {
  const { requestId, payeeId, amountSats, invoice, paymentHash } = payload;
  if (!requestId || !payeeId) {
    return { status: 400, body: { error: 'missing-fields' } };
  }

  if (backend === 'lnbits') {
    let hash = paymentHash;
    if (!hash && invoice) {
      const decoded = await lnbitsFetch('/api/v1/payments/decode', {
        method: 'POST',
        body: JSON.stringify({ data: invoice }),
      }, signal);
      hash = decoded.payment_hash;
    }
    if (!hash) {
      return { status: 400, body: { error: 'payment-hash-required' } };
    }
    const status = await lnbitsFetch(`/api/v1/payments/${hash}`, { method: 'GET' }, signal);
    if (!status.paid) {
      return { status: 200, body: { paid: false, detail: 'unpaid' } };
    }
    if (amountSats && Number(amountSats) !== Number(status.amount)) {
      return { status: 200, body: { paid: false, detail: 'amount-mismatch' } };
    }
    return { status: 200, body: { paid: true, settledAtMs: Date.now() } };
  }

  if (backend === 'lnd') {
    let hash = paymentHash;
    if (!hash && invoice) {
      const decoded = await lndFetch(`/v1/payreq/${encodeURIComponent(invoice)}`, {
        method: 'GET',
      }, signal);
      hash = decoded.payment_hash;
    }
    if (!hash) {
      return { status: 400, body: { error: 'payment-hash-required' } };
    }
    const hashB64 = hexToBase64(hash);
    const response = await lndFetch(`/v1/invoice/${encodeURIComponent(hashB64)}`, {
      method: 'GET',
    }, signal);
    if (!response.settled) {
      return { status: 200, body: { paid: false, detail: 'unsettled' } };
    }
    if (amountSats && Number(amountSats) !== Number(response.value)) {
      return { status: 200, body: { paid: false, detail: 'amount-mismatch' } };
    }
    return { status: 200, body: { paid: true, settledAtMs: Date.now() } };
  }

  return { status: 400, body: { error: 'unsupported-backend' } };
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return jsonResponse(res, 200, { ok: true, backend });
  }

  if (req.method === 'POST' && req.url === '/invoice') {
    const body = await readJson(req);
    if (!body.ok) {
      return jsonResponse(res, 400, { error: body.error });
    }
    try {
      const result = await withTimeout(
        (signal) => handleInvoice(body.value, signal),
        Number(process.env.LN_ADAPTER_TIMEOUT_MS),
      );
      return jsonResponse(res, result.status, result.body);
    } catch (error) {
      return jsonResponse(res, 502, { error: error instanceof Error ? error.message : 'invoice-failed' });
    }
  }

  if (req.method === 'POST' && req.url === '/verify') {
    const body = await readJson(req);
    if (!body.ok) {
      return jsonResponse(res, 400, { error: body.error });
    }
    try {
      const result = await withTimeout(
        (signal) => handleVerify(body.value, signal),
        Number(process.env.LN_ADAPTER_TIMEOUT_MS),
      );
      return jsonResponse(res, result.status, result.body);
    } catch (error) {
      return jsonResponse(res, 502, { error: error instanceof Error ? error.message : 'verify-failed' });
    }
  }

  return jsonResponse(res, 404, { error: 'not-found' });
});

server.listen(port, () => {
  console.log(`ln-adapter running on http://localhost:${port} (backend=${backend || 'none'})`);
});
