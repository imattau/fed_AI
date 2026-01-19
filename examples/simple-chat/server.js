#!/usr/bin/env node
const http = require('node:http');
const { readFile } = require('node:fs/promises');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const {
  ApiError,
  FedAiClient,
  generateKeyPair,
  parseErrorDetail,
  listModels,
  fitsContextWindow,
} = require('../../packages/sdk-js/dist');

const routerUrl = process.env.ROUTER_URL ?? 'http://localhost:8080';
const groqUrl = process.env.GROQ_URL ?? process.env.GROK_URL ?? 'https://api.groq.com';
const buildGroqUrl = (path) => {
  const trimmed = groqUrl.replace(/\/$/, '');
  const base = trimmed.endsWith('/openai/v1') ? trimmed : `${trimmed}/openai/v1`;
  return `${base}${path}`;
};
const defaultModelId = process.env.MODEL_ID ?? 'auto';
const maxTokens = Number(process.env.MAX_TOKENS ?? 128);
const port = Number(process.env.PORT ?? 3000);
const initialWalletSats = Number(process.env.WALLET_SATS ?? 2500);
const keysEnvPath = process.env.KEYS_ENV_PATH ?? '/keys/keys.env';

let walletBalanceSats = Number.isFinite(initialWalletSats) ? initialWalletSats : 0;
let cachedKeys = {};

const loadKeysEnv = () => {
  try {
    const raw = readFileSync(keysEnvPath, 'utf8');
    const entries = raw.split('\n').map((line) => line.trim()).filter(Boolean);
    cachedKeys = entries.reduce((acc, line) => {
      const [key, ...rest] = line.split('=');
      if (!key || rest.length === 0) return acc;
      acc[key] = rest.join('=');
      return acc;
    }, {});
  } catch {
    cachedKeys = {};
  }
};

loadKeysEnv();

const clientKeys = generateKeyPair();
const clientKeyId = clientKeys.publicKeyNpub;
const routerPublicKey =
  cachedKeys.ROUTER_PUBLIC_KEY_PEM || cachedKeys.ROUTER_KEY_ID || undefined;
const client = new FedAiClient({
  routerUrl,
  keyId: clientKeyId,
  privateKey: clientKeys.privateKeyNsec,
  routerPublicKey,
  verifyResponses: false,
  retry: {
    maxAttempts: 3,
    minDelayMs: 100,
    maxDelayMs: 1000,
    methods: ['GET'],
  },
});

const serveFile = async (res, filePath, contentType) => {
  const body = await readFile(filePath);
  res.writeHead(200, { 'content-type': contentType });
  res.end(body);
};

const splitList = (value) => {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const normalizeRouterList = (value, routerKeyId) => {
  if (!value || value === 'ROUTER_KEY_ID') {
    return routerKeyId ? [routerKeyId] : [];
  }
  return splitList(value);
};

const readConfig = () => {
  const routerKeyId = cachedKeys.ROUTER_KEY_ID;
  const nodeKeyId = cachedKeys.NODE_KEY_ID;
  const node2KeyId = cachedKeys.NODE2_KEY_ID;
  const node3KeyId = cachedKeys.NODE3_KEY_ID;

  return {
    router: {
      keyId: routerKeyId ?? null,
      postgres: Boolean(process.env.ROUTER_DB_URL || process.env.ROUTER_NONCE_STORE_URL),
      federation: {
        enabled: process.env.ROUTER_FEDERATION_ENABLED === 'true',
        rateLimitMax: Number(process.env.ROUTER_FEDERATION_RATE_LIMIT_MAX ?? 0) || 0,
        rateLimitWindowMs: Number(process.env.ROUTER_FEDERATION_RATE_LIMIT_WINDOW_MS ?? 0) || 0,
        nostr: {
        enabled: process.env.ROUTER_FEDERATION_NOSTR === 'true',
        relays: splitList(process.env.ROUTER_FEDERATION_NOSTR_RELAYS),
        follow: normalizeRouterList(process.env.ROUTER_FEDERATION_NOSTR_FOLLOW, routerKeyId),
        mute: splitList(process.env.ROUTER_FEDERATION_NOSTR_MUTE),
        block: splitList(process.env.ROUTER_FEDERATION_NOSTR_BLOCK),
        retryMinMs: Number(process.env.ROUTER_FEDERATION_NOSTR_RETRY_MIN_MS ?? 0) || 0,
        retryMaxMs: Number(process.env.ROUTER_FEDERATION_NOSTR_RETRY_MAX_MS ?? 0) || 0,
      },
      },
    },
    nodes: [
      {
        nodeId: 'node-llm',
        keyId: nodeKeyId ?? null,
        routerFollow: normalizeRouterList(process.env.NODE_ROUTER_FOLLOW, routerKeyId),
        routerMute: splitList(process.env.NODE_ROUTER_MUTE),
        routerBlock: splitList(process.env.NODE_ROUTER_BLOCK),
        postgresNonce: Boolean(process.env.NODE_NONCE_STORE_URL),
      },
      {
        nodeId: 'node-cpu',
        keyId: node2KeyId ?? null,
        routerFollow: normalizeRouterList(process.env.NODE_ROUTER_FOLLOW, routerKeyId),
        routerMute: splitList(process.env.NODE_ROUTER_MUTE),
        routerBlock: splitList(process.env.NODE_ROUTER_BLOCK),
        postgresNonce: Boolean(process.env.NODE_NONCE_STORE_URL),
      },
      {
        nodeId: 'node-grok',
        keyId: node3KeyId ?? null,
        routerFollow: normalizeRouterList(process.env.NODE_ROUTER_FOLLOW, routerKeyId),
        routerMute: splitList(process.env.NODE_ROUTER_MUTE),
        routerBlock: splitList(process.env.NODE_ROUTER_BLOCK),
        postgresNonce: Boolean(process.env.NODE_NONCE_STORE_URL),
      },
    ],
  };
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
  if (req.method === 'GET' && req.url === '/api/config') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(readConfig()));
    return;
  }
  if (req.method === 'GET' && req.url === '/api/router') {
    try {
      const health = await client.health();
      const nodes = await client.nodes();
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
      const nodes = await client.nodes();
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
  if (req.method === 'GET' && req.url === '/api/models') {
    try {
      const { active } = await client.nodes();
      const models = listModels(active);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(models));
    } catch (error) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'models-unavailable',
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
    const requestedModelId = typeof parsed.modelId === 'string' ? parsed.modelId : '';
    const apiKey = typeof parsed.apiKey === 'string' ? parsed.apiKey : '';
    if (!prompt) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'missing-prompt' }));
      return;
    }

    const request = {
      requestId: randomUUID(),
      modelId: requestedModelId && requestedModelId !== 'auto' ? requestedModelId : defaultModelId,
      prompt,
      maxTokens,
    };
    if (apiKey) {
      request.metadata = { apiKey };
    }
    try {
      if (request.modelId !== 'auto') {
        const { active } = await client.nodes();
        const models = listModels(active);
        const targetModel = models.find((m) => m.id === request.modelId);
        if (targetModel && targetModel.contextWindow) {
          if (!fitsContextWindow(prompt, maxTokens, targetModel.contextWindow)) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(
              JSON.stringify({
                error: 'context-window-exceeded',
                details: `Prompt + max output (${maxTokens}) exceeds model context (${targetModel.contextWindow})`,
              }),
            );
            return;
          }
        }
      }

      const result = await client.inferWithPayment(request, {
        sendReceipt: true,
        onPaymentRequired: async (paymentRequest) => {
          const amount = paymentRequest.payload.amountSats;
          if (walletBalanceSats < amount) {
            const balanceError = /** @type {Error & { code?: string }} */ (
              new Error('insufficient-balance')
            );
            balanceError.code = 'insufficient-balance';
            throw balanceError;
          }
          return client.createPaymentReceipt(paymentRequest);
        },
      });
      if (result.payment) {
        walletBalanceSats -= result.payment.request.payload.amountSats;
      }
      const output = result.response.payload.output ?? '';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ output, walletSats: walletBalanceSats }));
      return;
    } catch (error) {
      const err = /** @type {Error & { code?: string }} */ (error ?? new Error('unknown-error'));
      if (err.code === 'insufficient-balance') {
        res.writeHead(402, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'insufficient-balance',
            walletSats: walletBalanceSats,
          }),
        );
        return;
      }
      if (error instanceof ApiError) {
        const detail = parseErrorDetail(error.detail);
        res.writeHead(error.status, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            error: detail.error ?? 'router-error',
            details: detail.details ?? error.detail,
          }),
        );
        return;
      }
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'router-error',
          details: error instanceof Error ? error.message : String(error),
        }),
      );
      return;
    }

  }

  if (req.method === 'POST' && req.url === '/api/grok-check') {
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
    const apiKey = typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : '';
    if (!apiKey) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'missing-api-key' }));
      return;
    }
    try {
      const response = await fetch(buildGroqUrl('/models'), {
        method: 'GET',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'x-api-key': apiKey,
        },
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        res.writeHead(response.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'grok-key-invalid', detail }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (error) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'grok-check-failed',
          detail: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(port, () => {
  console.log(`simple chat client running on http://localhost:${port}`);
  console.log(`router: ${routerUrl}`);
});
