import http, { IncomingMessage, ServerResponse } from 'node:http';
import {
  checkReplay,
  InMemoryNonceStore,
  parsePublicKey,
  validateEnvelope,
  validateNodeDescriptor,
  verifyEnvelope,
} from '@fed-ai/protocol';
import type { Envelope, NodeDescriptor } from '@fed-ai/protocol';
import type { RouterService } from './server';

const readJsonBody = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString('utf8');
  return body ? JSON.parse(body) : null;
};

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
};

export const createRouterHttpServer = (service: RouterService): http.Server => {
  const nonceStore = new InMemoryNonceStore();

  return http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && req.url === '/register-node') {
      try {
        const body = await readJsonBody(req);
        const validation = validateEnvelope(body, validateNodeDescriptor);
        if (!validation.ok) {
          return sendJson(res, 400, { error: 'invalid-envelope', details: validation.errors });
        }

        const envelope = body as Envelope<NodeDescriptor>;
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

    if (req.method === 'GET' && req.url === '/nodes') {
      return sendJson(res, 200, { nodes: service.nodes });
    }

    return sendJson(res, 404, { error: 'not-found' });
  });
};
