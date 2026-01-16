import http, { IncomingMessage, ServerResponse } from 'node:http';
import {
  buildEnvelope,
  checkReplay,
  InMemoryNonceStore,
  parsePublicKey,
  signEnvelope,
  validateEnvelope,
  validateInferenceRequest,
  validateInferenceResponse,
  validateMeteringRecord,
  validateNodeDescriptor,
  validatePaymentReceipt,
  validateStakeCommit,
  validateStakeSlash,
  validateQuoteRequest,
  verifyEnvelope,
} from '@fed-ai/protocol';
import { verifyManifest } from '@fed-ai/manifest';
import { effectiveStakeUnits, recordCommit, recordSlash } from './accounting/staking';
import type {
  Envelope,
  InferenceRequest,
  InferenceResponse,
  MeteringRecord,
  NodeDescriptor,
  PaymentReceipt,
  PaymentRequest,
  QuoteRequest,
  QuoteResponse,
} from '@fed-ai/protocol';
import type { NodeManifest } from '@fed-ai/manifest';
import type { RouterConfig } from './config';
import type { RouterService } from './server';
import { selectNode } from './scheduler';

const NODE_HEARTBEAT_WINDOW_MS = 30_000;
const PAYMENT_WINDOW_MS = 5 * 60 * 1000;

const filterActiveNodes = (nodes: NodeDescriptor[]): NodeDescriptor[] => {
  const cutoff = Date.now() - NODE_HEARTBEAT_WINDOW_MS;
  return nodes.filter((node) => !node.lastHeartbeatMs || node.lastHeartbeatMs >= cutoff);
};

const receiptKey = (requestId: string, nodeId: string): string => `${requestId}:${nodeId}`;

const manifestScore = (manifest?: NodeManifest): number => {
  if (!manifest) {
    return 0;
  }

  let score = 0;
  switch (manifest.capability_bands.cpu) {
    case 'cpu_high':
      score += 30;
      break;
    case 'cpu_mid':
      score += 15;
      break;
    default:
      break;
  }
  switch (manifest.capability_bands.ram) {
    case 'ram_64_plus':
      score += 25;
      break;
    case 'ram_32':
      score += 15;
      break;
    case 'ram_16':
      score += 5;
      break;
    default:
      break;
  }
  if (manifest.capability_bands.disk === 'disk_ssd') {
    score += 10;
  }
  if (manifest.capability_bands.net === 'net_good') {
    score += 10;
  }
  switch (manifest.capability_bands.gpu) {
    case 'gpu_24gb_plus':
      score += 20;
      break;
    case 'gpu_16gb':
      score += 10;
      break;
    case 'gpu_8gb':
      score += 5;
      break;
    default:
      break;
  }

  return Math.min(score, 100);
};

const stakeScore = (service: RouterService, nodeId: string): number => {
  const units = effectiveStakeUnits(service.stakeStore, nodeId);
  const score = units / 100;
  return Math.min(20, score);
};

const applyManifestWeights = (service: RouterService): NodeDescriptor[] => {
  return service.nodes.map((node) => {
    const manifest = service.manifests.get(node.nodeId);
    const baseTrust = node.trustScore ?? 0;
    const manifestTrust = manifestScore(manifest);
    const stakeTrust = stakeScore(service, node.nodeId);
    return {
      ...node,
      trustScore: Math.min(100, baseTrust + manifestTrust + stakeTrust),
    };
  });
};

const readJsonBody = async (
  req: IncomingMessage,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString('utf8');
  if (!body) {
    return { ok: false, error: 'empty-body' };
  }
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch (error) {
    return { ok: false, error: 'invalid-json' };
  }
};

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
};

export const createRouterHttpServer = (service: RouterService, config: RouterConfig): http.Server => {
  const nonceStore = new InMemoryNonceStore();

  return http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && req.url === '/register-node') {
      try {
        const body = await readJsonBody(req);
        if (!body.ok) {
          return sendJson(res, 400, { error: body.error });
        }

        const validation = validateEnvelope(body.value, validateNodeDescriptor);
        if (!validation.ok) {
          return sendJson(res, 400, { error: 'invalid-envelope', details: validation.errors });
        }

        const envelope = body.value as Envelope<NodeDescriptor>;
        if (envelope.payload.keyId !== envelope.keyId) {
          return sendJson(res, 400, { error: 'key-id-mismatch' });
        }

        const replay = checkReplay(envelope, nonceStore);
        if (!replay.ok) {
          return sendJson(res, 400, { error: replay.error });
        }

        const publicKey = parsePublicKey(envelope.keyId);
        if (!verifyEnvelope(envelope, publicKey)) {
          return sendJson(res, 401, { error: 'invalid-signature' });
        }

        const updated = {
          ...envelope.payload,
          lastHeartbeatMs: Date.now(),
        };

        service.nodes = service.nodes.filter((node) => node.nodeId !== updated.nodeId);
        service.nodes.push(updated);

        return sendJson(res, 200, { ok: true });
      } catch (error) {
        return sendJson(res, 500, { error: 'internal-error' });
      }
    }

    if (req.method === 'POST' && req.url === '/manifest') {
      try {
        const body = await readJsonBody(req);
        if (!body.ok) {
          return sendJson(res, 400, { error: body.error });
        }

        const manifest = body.value as NodeManifest;
        if (!manifest.signature) {
          return sendJson(res, 400, { error: 'missing-signature' });
        }

        const publicKey = parsePublicKey(manifest.signature.keyId);
        if (!verifyManifest(manifest, publicKey)) {
          return sendJson(res, 401, { error: 'invalid-signature' });
        }

        service.manifests.set(manifest.id, manifest);
        return sendJson(res, 200, { ok: true });
      } catch (error) {
        return sendJson(res, 500, { error: 'internal-error' });
      }
    }

    if (req.method === 'POST' && req.url === '/stake/commit') {
      try {
        const body = await readJsonBody(req);
        if (!body.ok) {
          return sendJson(res, 400, { error: body.error });
        }

        const validation = validateEnvelope(body.value, validateStakeCommit);
        if (!validation.ok) {
          return sendJson(res, 400, { error: 'invalid-envelope', details: validation.errors });
        }

        const envelope = body.value as Envelope<import('@fed-ai/protocol').StakeCommit>;
        if (envelope.payload.actorId !== envelope.keyId) {
          return sendJson(res, 400, { error: 'actor-key-mismatch' });
        }

        const publicKey = parsePublicKey(envelope.keyId);
        if (!verifyEnvelope(envelope, publicKey)) {
          return sendJson(res, 401, { error: 'invalid-signature' });
        }

        recordCommit(service.stakeStore, envelope);
        return sendJson(res, 200, { ok: true });
      } catch (error) {
        return sendJson(res, 500, { error: 'internal-error' });
      }
    }

    if (req.method === 'POST' && req.url === '/stake/slash') {
      try {
        const body = await readJsonBody(req);
        if (!body.ok) {
          return sendJson(res, 400, { error: body.error });
        }

        const validation = validateEnvelope(body.value, validateStakeSlash);
        if (!validation.ok) {
          return sendJson(res, 400, { error: 'invalid-envelope', details: validation.errors });
        }

        const envelope = body.value as Envelope<import('@fed-ai/protocol').StakeSlash>;
        if (envelope.keyId !== config.keyId) {
          return sendJson(res, 403, { error: 'router-only' });
        }
        if (!config.privateKey) {
          return sendJson(res, 500, { error: 'router-private-key-missing' });
        }

        const routerKey = parsePublicKey(config.keyId);
        if (!verifyEnvelope(envelope, routerKey)) {
          return sendJson(res, 401, { error: 'invalid-signature' });
        }

        recordSlash(service.stakeStore, envelope.payload);
        return sendJson(res, 200, { ok: true });
      } catch (error) {
        return sendJson(res, 500, { error: 'internal-error' });
      }
    }

    if (req.method === 'POST' && req.url === '/quote') {
      try {
        const body = await readJsonBody(req);
        if (!body.ok) {
          return sendJson(res, 400, { error: body.error });
        }

        const validation = validateEnvelope(body.value, validateQuoteRequest);
        if (!validation.ok) {
          return sendJson(res, 400, { error: 'invalid-envelope', details: validation.errors });
        }

        const envelope = body.value as Envelope<QuoteRequest>;
        const replay = checkReplay(envelope, nonceStore);
        if (!replay.ok) {
          return sendJson(res, 400, { error: replay.error });
        }

        const clientKey = parsePublicKey(envelope.keyId);
        if (!verifyEnvelope(envelope, clientKey)) {
          return sendJson(res, 401, { error: 'invalid-signature' });
        }

        if (!config.privateKey) {
          return sendJson(res, 500, { error: 'router-private-key-missing' });
        }

        const selection = selectNode({
          nodes: filterActiveNodes(applyManifestWeights(service)),
          request: envelope.payload,
        });

        if (!selection.selected) {
          return sendJson(res, 503, { error: selection.reason ?? 'no-nodes-available' });
        }

        const capability = selection.selected.capabilities.find(
          (item) => item.modelId === envelope.payload.modelId,
        );

        if (!capability) {
          return sendJson(res, 503, { error: 'no-capable-nodes' });
        }

        const total =
          capability.pricing.inputRate * envelope.payload.inputTokensEstimate +
          capability.pricing.outputRate * envelope.payload.outputTokensEstimate;

        const quote: QuoteResponse = {
          requestId: envelope.payload.requestId,
          modelId: envelope.payload.modelId,
          nodeId: selection.selected.nodeId,
          price: { total, currency: capability.pricing.currency },
          latencyEstimateMs: 0,
          expiresAtMs: Date.now() + 60_000,
        };

        const responseEnvelope = signEnvelope(
          buildEnvelope(quote, envelope.nonce, Date.now(), config.keyId),
          config.privateKey,
        );

        return sendJson(res, 200, { quote: responseEnvelope });
      } catch (error) {
        return sendJson(res, 500, { error: 'internal-error' });
      }
    }

    if (req.method === 'POST' && req.url === '/payment-receipt') {
      try {
        const body = await readJsonBody(req);
        if (!body.ok) {
          return sendJson(res, 400, { error: body.error });
        }

        const validation = validateEnvelope(body.value, validatePaymentReceipt);
        if (!validation.ok) {
          return sendJson(res, 400, { error: 'invalid-envelope', details: validation.errors });
        }

        const envelope = body.value as Envelope<PaymentReceipt>;
        const clientKey = parsePublicKey(envelope.keyId);
        if (!verifyEnvelope(envelope, clientKey)) {
          return sendJson(res, 401, { error: 'invalid-signature' });
        }

        const key = receiptKey(envelope.payload.requestId, envelope.payload.nodeId);
        service.paymentReceipts.set(key, envelope);

        return sendJson(res, 200, { ok: true });
      } catch (error) {
        return sendJson(res, 500, { error: 'internal-error' });
      }
    }

    if (req.method === 'POST' && req.url === '/infer') {
      try {
        const body = await readJsonBody(req);
        if (!body.ok) {
          return sendJson(res, 400, { error: body.error });
        }

        const validation = validateEnvelope(body.value, validateInferenceRequest);
        if (!validation.ok) {
          return sendJson(res, 400, { error: 'invalid-envelope', details: validation.errors });
        }

        const envelope = body.value as Envelope<InferenceRequest>;
        const replay = checkReplay(envelope, nonceStore);
        if (!replay.ok) {
          return sendJson(res, 400, { error: replay.error });
        }

        const clientKey = parsePublicKey(envelope.keyId);
        if (!verifyEnvelope(envelope, clientKey)) {
          return sendJson(res, 401, { error: 'invalid-signature' });
        }

        if (!config.privateKey) {
          return sendJson(res, 500, { error: 'router-private-key-missing' });
        }

        const selection = selectNode({
          nodes: filterActiveNodes(applyManifestWeights(service)),
          request: {
            requestId: envelope.payload.requestId,
            modelId: envelope.payload.modelId,
            maxTokens: envelope.payload.maxTokens,
            inputTokensEstimate: envelope.payload.prompt.length,
            outputTokensEstimate: envelope.payload.maxTokens,
          },
        });

        const node = selection.selected;

        if (!node) {
          return sendJson(res, 503, { error: 'no-nodes-available' });
        }

        if (config.requirePayment) {
          const key = receiptKey(envelope.payload.requestId, node.nodeId);
          if (!service.paymentReceipts.has(key)) {
            const capability = node.capabilities.find(
              (item) => item.modelId === envelope.payload.modelId,
            );
            if (!capability) {
              return sendJson(res, 503, { error: 'no-capable-nodes' });
            }

            const total =
              capability.pricing.inputRate * envelope.payload.prompt.length +
              capability.pricing.outputRate * envelope.payload.maxTokens;

            const paymentRequest: PaymentRequest = {
              requestId: envelope.payload.requestId,
              nodeId: node.nodeId,
              amountSats: Math.max(1, Math.round(total)),
              invoice: `lnbc-mock-${envelope.payload.requestId}`,
              expiresAtMs: Date.now() + PAYMENT_WINDOW_MS,
              metadata: {
                currency: capability.pricing.currency,
              },
            };

            const paymentEnvelope = signEnvelope(
              buildEnvelope(paymentRequest, envelope.nonce, Date.now(), config.keyId),
              config.privateKey,
            );

            return sendJson(res, 402, { error: 'payment-required', payment: paymentEnvelope });
          }
        }

        const receiptKeyId = receiptKey(envelope.payload.requestId, node.nodeId);
        const storedReceipt = service.paymentReceipts.get(receiptKeyId);
        const requestPayload = storedReceipt
          ? { ...envelope.payload, paymentReceipt: storedReceipt }
          : envelope.payload;

        const forwardEnvelope = signEnvelope(
          buildEnvelope(requestPayload, envelope.nonce, Date.now(), config.keyId),
          config.privateKey,
        );

        const nodeResponse = await fetch(`${node.endpoint}/infer`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(forwardEnvelope),
        });

        if (!nodeResponse.ok) {
          return sendJson(res, 502, { error: 'node-error' });
        }

        const nodeBody = (await nodeResponse.json()) as {
          response: Envelope<InferenceResponse>;
          metering: Envelope<MeteringRecord>;
        };

        const responseValidation = validateEnvelope(nodeBody.response, validateInferenceResponse);
        if (!responseValidation.ok) {
          return sendJson(res, 502, { error: 'invalid-node-response', details: responseValidation.errors });
        }

        const meteringValidation = validateEnvelope(nodeBody.metering, validateMeteringRecord);
        if (!meteringValidation.ok) {
          return sendJson(res, 502, { error: 'invalid-metering', details: meteringValidation.errors });
        }

        const nodeKey = parsePublicKey(node.keyId);
        if (nodeBody.response.keyId !== node.keyId || !verifyEnvelope(nodeBody.response, nodeKey)) {
          return sendJson(res, 502, { error: 'node-response-signature-invalid' });
        }
        if (nodeBody.metering.keyId !== node.keyId || !verifyEnvelope(nodeBody.metering, nodeKey)) {
          return sendJson(res, 502, { error: 'node-metering-signature-invalid' });
        }

        return sendJson(res, 200, { response: nodeBody.response, metering: nodeBody.metering });
      } catch (error) {
        return sendJson(res, 500, { error: 'internal-error' });
      }
    }

    if (req.method === 'GET' && req.url === '/nodes') {
      return sendJson(res, 200, { nodes: service.nodes, active: filterActiveNodes(service.nodes) });
    }

    return sendJson(res, 404, { error: 'not-found' });
  });
};
