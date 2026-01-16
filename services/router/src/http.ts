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
  verifyEnvelope,
} from '@fed-ai/protocol';
import type {
  Envelope,
  InferenceRequest,
  InferenceResponse,
  MeteringRecord,
  NodeDescriptor,
} from '@fed-ai/protocol';
import type { RouterConfig } from './config';
import type { RouterService } from './server';

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

        service.nodes = service.nodes.filter((node) => node.nodeId !== envelope.payload.nodeId);
        service.nodes.push(envelope.payload);

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

        const node = service.nodes.find((candidate) =>
          candidate.capabilities.some((capability) => capability.modelId === envelope.payload.modelId),
        );

        if (!node) {
          return sendJson(res, 503, { error: 'no-nodes-available' });
        }

        const forwardEnvelope = signEnvelope(
          buildEnvelope(envelope.payload, envelope.nonce, Date.now(), config.keyId),
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
      return sendJson(res, 200, { nodes: service.nodes });
    }

    return sendJson(res, 404, { error: 'not-found' });
  });
};
