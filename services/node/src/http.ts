import http, { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import {
  buildEnvelope,
  checkReplay,
  InMemoryNonceStore,
  parsePublicKey,
  signEnvelope,
  validateEnvelope,
  validateInferenceRequest,
  validatePaymentReceipt,
  verifyEnvelope,
} from '@fed-ai/protocol';
import type {
  Envelope,
  InferenceRequest,
  InferenceResponse,
  MeteringRecord,
  PaymentReceipt,
} from '@fed-ai/protocol';
import type { NodeConfig } from './config';
import type { NodeService } from './server';
import {
  nodeInferenceDuration,
  nodeInferenceRequests,
  nodeReceiptFailures,
  nodeRegistry,
  nodeTracer,
} from './observability';

const readJsonBody = async (
  req: IncomingMessage,
  maxBytes?: number,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> => {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (maxBytes !== undefined && totalBytes > maxBytes) {
      return { ok: false, error: 'payload-too-large' };
    }
    chunks.push(buffer);
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

const hashPrompt = (prompt: string): string => {
  return createHash('sha256').update(prompt, 'utf8').digest('hex');
};

export const createNodeHttpServer = (service: NodeService, config: NodeConfig): http.Server => {
  const nonceStore = new InMemoryNonceStore();

  return http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && req.url === '/metrics') {
      const metrics = await nodeRegistry.metrics();
      res.setHeader('content-type', nodeRegistry.contentType);
      res.end(metrics);
      return;
    }

    if (req.method === 'POST' && req.url === '/infer') {
      const span = nodeTracer.startSpan('node.infer', {
        attributes: { component: 'node', 'node.id': config.nodeId },
      });
      const timer = nodeInferenceDuration.startTimer();
      let statusLabel = '200';
      let inFlightRegistered = false;
      const respond = (status: number, body: unknown): void => {
        statusLabel = status.toString();
        span.setAttribute('http.status_code', status);
        sendJson(res, status, body);
      };
      try {
        const body = await readJsonBody(req, config.maxRequestBytes);
        if (!body.ok) {
          const status = body.error === 'payload-too-large' ? 413 : 400;
          return respond(status, { error: body.error });
        }

        const validation = validateEnvelope(body.value, validateInferenceRequest);
        if (!validation.ok) {
          return respond(400, { error: 'invalid-envelope', details: validation.errors });
        }

        const envelope = body.value as Envelope<InferenceRequest>;
        const promptBytes = Buffer.byteLength(envelope.payload.prompt, 'utf8');
        if (config.maxPromptBytes !== undefined && promptBytes > config.maxPromptBytes) {
          return respond(413, { error: 'prompt-too-large' });
        }
        if (config.maxTokens !== undefined && envelope.payload.maxTokens > config.maxTokens) {
          return respond(400, { error: 'max-tokens-exceeded' });
        }
        if (config.routerKeyId && envelope.keyId !== config.routerKeyId) {
          return respond(401, { error: 'router-key-id-mismatch' });
        }
        if (!config.routerPublicKey) {
          return respond(500, { error: 'router-public-key-missing' });
        }
        if (!verifyEnvelope(envelope, config.routerPublicKey)) {
          return respond(401, { error: 'invalid-signature' });
        }

        const replay = checkReplay(envelope, nonceStore);
        if (!replay.ok) {
          return respond(400, { error: replay.error });
        }

        if (config.requirePayment) {
          const receipts = envelope.payload.paymentReceipts ?? [];
          const receiptEnvelope = receipts.find(
            (item) => item.payload.payeeType === 'node' && item.payload.payeeId === config.nodeId,
          );

          if (!receiptEnvelope) {
            nodeReceiptFailures.inc();
            return respond(402, { error: 'payment-required' });
          }

          const receiptValidation = validateEnvelope(receiptEnvelope, validatePaymentReceipt);
          if (!receiptValidation.ok) {
            nodeReceiptFailures.inc();
            return respond(400, { error: 'invalid-payment-receipt', details: receiptValidation.errors });
          }

          const receipt = receiptEnvelope as Envelope<PaymentReceipt>;
          if (receipt.payload.amountSats < 1) {
            nodeReceiptFailures.inc();
            return respond(400, { error: 'payment-amount-invalid' });
          }
          if (receipt.payload.requestId !== envelope.payload.requestId) {
            nodeReceiptFailures.inc();
            return respond(400, { error: 'payment-request-mismatch' });
          }

          const clientKey = parsePublicKey(receipt.keyId);
          if (!verifyEnvelope(receipt, clientKey)) {
            nodeReceiptFailures.inc();
            return respond(401, { error: 'invalid-payment-receipt-signature' });
          }
        }

        if (!config.privateKey) {
          return respond(500, { error: 'node-private-key-missing' });
        }

        const currentLoad = config.capacityCurrentLoad + service.inFlight;
        if (config.capacityMaxConcurrent <= 0 || currentLoad >= config.capacityMaxConcurrent) {
          return respond(429, { error: 'capacity-exhausted' });
        }
        service.inFlight += 1;
        inFlightRegistered = true;

        const response = config.maxInferenceMs
          ? await Promise.race([
              service.runner.infer(envelope.payload),
              new Promise<InferenceResponse>((_, reject) =>
                setTimeout(() => reject(new Error('runner-timeout')), config.maxInferenceMs),
              ),
            ])
          : await service.runner.infer(envelope.payload);
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

        return respond(200, { response: responseEnvelope, metering: meteringEnvelope });
      } catch (error) {
        if (error instanceof Error && error.message === 'runner-timeout') {
          return respond(504, { error: 'runner-timeout' });
        }
        return respond(500, { error: 'internal-error' });
      } finally {
        if (inFlightRegistered) {
          service.inFlight = Math.max(0, service.inFlight - 1);
        }
        timer();
        nodeInferenceRequests.labels(statusLabel).inc();
        span.end();
      }
    }

    return sendJson(res, 404, { error: 'not-found' });
  });
};
