import http, { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import {
  buildEnvelope,
  checkReplay,
  InMemoryNonceStore,
  signEnvelope,
  validateEnvelope,
  validateInferenceRequest,
  verifyEnvelope,
} from '@fed-ai/protocol';
import type { Envelope, InferenceRequest, InferenceResponse, MeteringRecord } from '@fed-ai/protocol';
import type { NodeConfig } from './config';
import type { NodeService } from './server';

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

const hashPrompt = (prompt: string): string => {
  return createHash('sha256').update(prompt, 'utf8').digest('hex');
};

export const createNodeHttpServer = (service: NodeService, config: NodeConfig): http.Server => {
  const nonceStore = new InMemoryNonceStore();

  return http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && req.url === '/infer') {
      try {
        const body = await readJsonBody(req);
        const validation = validateEnvelope(body, validateInferenceRequest);
        if (!validation.ok) {
          return sendJson(res, 400, { error: 'invalid-envelope', details: validation.errors });
        }

        const envelope = body as Envelope<InferenceRequest>;
        if (!config.routerPublicKey) {
          return sendJson(res, 500, { error: 'router-public-key-missing' });
        }
        if (!verifyEnvelope(envelope, config.routerPublicKey)) {
          return sendJson(res, 401, { error: 'invalid-signature' });
        }

        const replay = checkReplay(envelope, nonceStore);
        if (!replay.ok) {
          return sendJson(res, 400, { error: replay.error });
        }

        if (!config.privateKey) {
          return sendJson(res, 500, { error: 'node-private-key-missing' });
        }

        const response = await service.runner.infer(envelope.payload);
        const responseEnvelope = signEnvelope(
          buildEnvelope(response, randomUUID(), Date.now(), config.keyId),
          config.privateKey,
        );

        const metering: MeteringRecord = {
          requestId: response.requestId,
          nodeId: config.nodeId,
          modelId: response.modelId,
          promptHash: hashPrompt(envelope.payload.prompt),
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          wallTimeMs: response.latencyMs,
          bytesIn: Buffer.byteLength(envelope.payload.prompt, 'utf8'),
          bytesOut: Buffer.byteLength(response.output, 'utf8'),
          ts: Date.now(),
        };

        const meteringEnvelope = signEnvelope(
          buildEnvelope(metering, randomUUID(), Date.now(), config.keyId),
          config.privateKey,
        );

        return sendJson(res, 200, { response: responseEnvelope, metering: meteringEnvelope });
      } catch (error) {
        return sendJson(res, 500, { error: 'internal-error' });
      }
    }

    return sendJson(res, 404, { error: 'not-found' });
  });
};
