import http, { IncomingMessage, ServerResponse } from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import {
  buildEnvelope,
  checkReplay,
  FileNonceStore,
  InMemoryNonceStore,
  NonceStore,
  isNostrNpub,
  parsePublicKey,
  signEnvelope,
  validateEnvelope,
  validateInferenceRequest,
  validateInferenceResponse,
  validateMeteringRecord,
  validateNodeAwardPayload,
  validateNodeBidPayload,
  validateNodeRfbPayload,
  validatePaymentReceipt,
  verifyEnvelope,
  estimateTokensFromText,
} from '@fed-ai/protocol';
import type {
  Envelope,
  InferenceRequest,
  InferenceResponse,
  MeteringRecord,
  NodeAwardPayload,
  NodeBidPayload,
  NodeOffloadRequest,
  NodeRfbPayload,
  PaymentSplit,
  PaymentReceipt,
} from '@fed-ai/protocol';
import type { NodeConfig } from './config';
import type { NodeService } from './server';
import { checkRouterAccess } from './authz';
import { logWarn } from './logging';
import { createRateLimiter } from './rate-limit';
import { verifyPaymentReceipt } from './payments/verify';
import { createEnvelopeWorkerPool } from './workers/envelope-worker-pool';
import type { EnvelopeWorkerPool } from './workers/envelope-worker-pool';
import type { EnvelopeValidatorName } from './workers/types';
import {
  nodeInferenceDuration,
  nodeInferenceRequests,
  nodeReceiptFailures,
  nodeRegistry,
  nodeTracer,
} from './observability';
import { createAdminHandler } from './admin';

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

const startSse = (res: ServerResponse): void => {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
};

const sendSseEvent = (res: ServerResponse, event: string, data: unknown): void => {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
};

type EnvelopeValidator = (value: unknown) => { ok: true } | { ok: false; errors: string[] };

const validateSignedEnvelope = async <T>(
  raw: unknown,
  validatorName: EnvelopeValidatorName,
  validator: EnvelopeValidator,
  workerPool: EnvelopeWorkerPool | null,
  publicKeyHex?: string,
): Promise<
  | { ok: true; envelope: Envelope<T> }
  | { ok: false; status: number; error: string; details?: string[] }
> => {
  if (workerPool) {
    try {
      const workerResult = await workerPool.validateAndVerify({
        envelope: raw,
        validator: validatorName,
        publicKeyHex,
      });
      if (workerResult.ok) {
        const envelope = raw as Envelope<T>;
        if (!isNostrNpub(envelope.keyId)) {
          return { ok: false, status: 400, error: 'invalid-key-id' };
        }
        return { ok: true, envelope };
      }
      if (workerResult.error === 'invalid-envelope') {
        return {
          ok: false,
          status: 400,
          error: 'invalid-envelope',
          details: workerResult.errors,
        };
      }
      if (workerResult.error === 'invalid-key-id') {
        return { ok: false, status: 400, error: 'invalid-key-id' };
      }
      if (workerResult.error === 'invalid-signature') {
        return { ok: false, status: 401, error: 'invalid-signature' };
      }
    } catch {
      // Fall through to synchronous validation on worker failure.
    }
  }

  const validation = validateEnvelope(raw, validator);
  if (!validation.ok) {
    return { ok: false, status: 400, error: 'invalid-envelope', details: validation.errors };
  }
  const envelope = raw as Envelope<T>;
  if (!isNostrNpub(envelope.keyId)) {
    return { ok: false, status: 400, error: 'invalid-key-id' };
  }
  const publicKey = publicKeyHex ? Buffer.from(publicKeyHex, 'hex') : parsePublicKey(envelope.keyId);
  if (!verifyEnvelope(envelope, publicKey)) {
    return { ok: false, status: 401, error: 'invalid-signature' };
  }
  return { ok: true, envelope };
};

const selectRouterPublicKeyHex = (config: NodeConfig, raw: unknown): string | undefined => {
  if (!config.routerKeyId || !config.routerPublicKey) {
    return undefined;
  }
  if (raw && typeof raw === 'object' && 'keyId' in raw) {
    const keyId = (raw as Envelope<unknown>).keyId;
    if (keyId === config.routerKeyId) {
      return Buffer.from(config.routerPublicKey).toString('hex');
    }
  }
  return undefined;
};

const ensureRequestId = (req: IncomingMessage, res: ServerResponse): string => {
  const header = req.headers['x-request-id'];
  const requestId = Array.isArray(header) ? header[0] : header ?? randomUUID();
  res.setHeader('x-request-id', requestId);
  return requestId;
};

const sumSplits = (splits?: PaymentSplit[]): number => {
  return (splits ?? []).reduce((sum, split) => sum + split.amountSats, 0);
};

const routerFeeFromSplits = (splits?: PaymentSplit[]): number => {
  return (splits ?? [])
    .filter((split) => split.payeeType === 'router')
    .reduce((sum, split) => sum + split.amountSats, 0);
};

const nodeAmountFromSplits = (splits?: PaymentSplit[]): number => {
  return (splits ?? [])
    .filter((split) => split.payeeType === 'node')
    .reduce((sum, split) => sum + split.amountSats, 0);
};

const hashPrompt = (prompt: string): string => {
  return createHash('sha256').update(prompt, 'utf8').digest('hex');
};

export const createNodeHttpServer = (
  service: NodeService,
  config: NodeConfig,
  nonceStore?: NonceStore,
): http.Server => {
  const store = nonceStore ?? (config.nonceStorePath
    ? new FileNonceStore(config.nonceStorePath)
    : new InMemoryNonceStore());
  const envelopeWorkerPool = config.workerThreads?.enabled
    ? createEnvelopeWorkerPool({
        maxWorkers: config.workerThreads.maxWorkers,
        maxQueue: config.workerThreads.maxQueue,
        taskTimeoutMs: config.workerThreads.taskTimeoutMs,
      })
    : null;
  const adminHandler = createAdminHandler(service, config);
  const startedAtMs = Date.now();
  const ingressRateLimiter = createRateLimiter(config.rateLimitMax, config.rateLimitWindowMs);
  const checkIngressRateLimit = (
    keyId: string,
  ): { ok: true } | { ok: false; status: number; error: string } => {
    if (!ingressRateLimiter) {
      return { ok: true };
    }
    if (!ingressRateLimiter.allow(keyId)) {
      return { ok: false, status: 429, error: 'rate-limited' };
    }
    return { ok: true };
  };
  const auctionRateWindowMs = 60_000;
  const auctionRateCounters = new Map<string, { count: number; resetAt: number }>();
  let modelContextWindows: Map<string, number> | null = null;
  let modelContextLoad: Promise<Map<string, number>> | null = null;

  const loadModelContextWindows = async (): Promise<Map<string, number>> => {
    if (modelContextWindows) {
      return modelContextWindows;
    }
    if (!modelContextLoad) {
      modelContextLoad = (async () => {
        const models = await service.runner.listModels();
        const cache = new Map<string, number>();
        for (const model of models) {
          if (model.contextWindow) {
            cache.set(model.id, model.contextWindow);
          }
        }
        modelContextWindows = cache;
        return cache;
      })();
    }
    return modelContextLoad;
  };

  const getModelContextWindow = async (modelId: string): Promise<number | undefined> => {
    try {
      const cache = await loadModelContextWindows();
      return cache.get(modelId);
    } catch {
      modelContextLoad = null;
      return undefined;
    }
  };

  const checkContextWindow = async (
    modelId: string,
    prompt: string,
    maxTokens: number,
  ): Promise<{ ok: true; inputTokensEstimate: number } | { ok: false; error: string }> => {
    const inputTokensEstimate = estimateTokensFromText(prompt);
    const contextWindow = await getModelContextWindow(modelId);
    if (contextWindow !== undefined && inputTokensEstimate + maxTokens > contextWindow) {
      return { ok: false, error: 'context-window-exceeded' };
    }
    return { ok: true, inputTokensEstimate };
  };

  const checkAuctionRateLimit = (keyId: string): boolean => {
    if (!config.offloadAuctionRateLimit || config.offloadAuctionRateLimit <= 0) {
      return true;
    }
    const now = Date.now();
    const existing = auctionRateCounters.get(keyId);
    if (!existing || existing.resetAt <= now) {
      auctionRateCounters.set(keyId, { count: 1, resetAt: now + auctionRateWindowMs });
      return true;
    }
    if (existing.count >= config.offloadAuctionRateLimit) {
      return false;
    }
    existing.count += 1;
    return true;
  };

  const validateOffloadResult = (
    payload: { response: Envelope<InferenceResponse>; metering: Envelope<MeteringRecord> },
    expectedRequestId: string,
  ): { ok: true } | { ok: false; error: string } => {
    const responseValidation = validateEnvelope(payload.response, validateInferenceResponse);
    if (!responseValidation.ok) {
      return { ok: false, error: 'invalid-offload-response' };
    }
    const meteringValidation = validateEnvelope(payload.metering, validateMeteringRecord);
    if (!meteringValidation.ok) {
      return { ok: false, error: 'invalid-offload-metering' };
    }
    if (
      payload.response.payload.requestId !== expectedRequestId ||
      payload.metering.payload.requestId !== expectedRequestId
    ) {
      return { ok: false, error: 'offload-request-mismatch' };
    }
    if (payload.response.keyId !== payload.metering.keyId) {
      return { ok: false, error: 'offload-key-mismatch' };
    }
    const publicKey = parsePublicKey(payload.response.keyId);
    if (!verifyEnvelope(payload.response, publicKey) || !verifyEnvelope(payload.metering, publicKey)) {
      return { ok: false, error: 'offload-signature-invalid' };
    }
    return { ok: true };
  };

  const attemptOffload = async (
    envelope: Envelope<InferenceRequest>,
  ): Promise<
    | { ok: true; body: { response: Envelope<InferenceResponse>; metering: Envelope<MeteringRecord> } }
    | { ok: false; status: number; error: string }
  > => {
    const peers = config.offloadPeers ?? [];
    const forwardToPeer = async (
      peer: string,
    ): Promise<
      | { ok: true; body: { response: Envelope<InferenceResponse>; metering: Envelope<MeteringRecord> } }
      | { ok: false }
    > => {
      try {
        const response = await fetch(`${peer.replace(/\/$/, '')}/infer`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(envelope),
        });
        if (!response.ok) {
          return { ok: false };
        }
        const payload = (await response.json()) as {
          response: Envelope<InferenceResponse>;
          metering: Envelope<MeteringRecord>;
        };
        const validation = validateOffloadResult(payload, envelope.payload.requestId);
        if (!validation.ok) {
          return { ok: false };
        }
        return { ok: true, body: payload };
      } catch {
        return { ok: false };
      }
    };

    const auctionPeers = peers.filter((peer) => peer && peer !== config.endpoint);
    const auctionMs = Math.max(200, config.offloadAuctionMs ?? 800);
    if (config.offloadAuctionEnabled && auctionPeers.length > 0) {
      if (!config.privateKey) {
        return { ok: false, status: 500, error: 'node-private-key-missing' };
      }
      const rfbPayload: NodeRfbPayload = {
        requestId: envelope.payload.requestId,
        jobType: envelope.payload.jobType,
        sizeEstimate: {
          tokens: estimateTokensFromText(envelope.payload.prompt) + envelope.payload.maxTokens,
          bytes: Buffer.byteLength(envelope.payload.prompt, 'utf8'),
        },
        deadlineMs: Date.now() + auctionMs,
        maxRuntimeMs: config.maxInferenceMs,
      };
      const rfbEnvelope = signEnvelope(
        buildEnvelope(rfbPayload, randomUUID(), Date.now(), config.keyId),
        config.privateKey,
      );
      const bidResults = await Promise.allSettled(
        auctionPeers.map(async (peer) => {
          const response = await fetch(`${peer.replace(/\/$/, '')}/offload/rfb`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(rfbEnvelope),
            signal: AbortSignal.timeout(auctionMs),
          });
          if (!response.ok) {
            return null;
          }
          const bidEnvelope = (await response.json()) as Envelope<NodeBidPayload>;
          const validation = validateEnvelope(bidEnvelope, validateNodeBidPayload);
          if (!validation.ok || bidEnvelope.payload.requestId !== envelope.payload.requestId) {
            return null;
          }
          if (!isNostrNpub(bidEnvelope.keyId)) {
            return null;
          }
          const bidKey = parsePublicKey(bidEnvelope.keyId);
          if (!verifyEnvelope(bidEnvelope, bidKey)) {
            return null;
          }
          if (bidEnvelope.payload.bidExpiryMs < Date.now()) {
            return null;
          }
          return { peer, bid: bidEnvelope };
        }),
      );

      const bids = bidResults
        .filter(
          (result): result is PromiseFulfilledResult<{ peer: string; bid: Envelope<NodeBidPayload> } | null> =>
            result.status === 'fulfilled',
        )
        .map((result) => result.value)
        .filter((entry): entry is { peer: string; bid: Envelope<NodeBidPayload> } => Boolean(entry));

      if (bids.length > 0) {
        bids.sort((a, b) => {
          if (a.bid.payload.etaMs !== b.bid.payload.etaMs) {
            return a.bid.payload.etaMs - b.bid.payload.etaMs;
          }
          const priceA = a.bid.payload.priceMsat ?? Number.MAX_SAFE_INTEGER;
          const priceB = b.bid.payload.priceMsat ?? Number.MAX_SAFE_INTEGER;
          return priceA - priceB;
        });

        const winner = bids[0];
        const awardPayload: NodeAwardPayload = {
          requestId: envelope.payload.requestId,
          winnerKeyId: winner.bid.keyId,
          acceptedPriceMsat: winner.bid.payload.priceMsat,
          awardExpiryMs: Date.now() + auctionMs,
        };
        const awardEnvelope = signEnvelope(
          buildEnvelope(awardPayload, randomUUID(), Date.now(), config.keyId),
          config.privateKey,
        );
        try {
          await fetch(`${winner.peer.replace(/\/$/, '')}/offload/award`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(awardEnvelope),
            signal: AbortSignal.timeout(auctionMs),
          });
        } catch {
          // Best-effort award notification before forwarding the job.
        }

        const forwarded = await forwardToPeer(winner.peer);
        if (forwarded.ok) {
          return { ok: true, body: forwarded.body };
        }
      }
    }

    for (const peer of auctionPeers) {
      const forwarded = await forwardToPeer(peer);
      if (forwarded.ok) {
        return { ok: true, body: forwarded.body };
      }
    }

    if (config.offloadRouter) {
      if (!config.privateKey) {
        return { ok: false, status: 500, error: 'node-private-key-missing' };
      }
      const offload: NodeOffloadRequest = {
        requestId: envelope.payload.requestId,
        originNodeId: config.nodeId,
        request: envelope.payload,
        avoidNodeIds: [config.nodeId],
      };
      const offloadEnvelope = signEnvelope(
        buildEnvelope(offload, randomUUID(), Date.now(), config.keyId),
        config.privateKey,
      );
      try {
        const response = await fetch(`${config.routerEndpoint.replace(/\/$/, '')}/node/offload`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(offloadEnvelope),
        });
        if (!response.ok) {
          return { ok: false, status: response.status, error: 'router-offload-failed' };
        }
        const payload = (await response.json()) as {
          response: Envelope<InferenceResponse>;
          metering: Envelope<MeteringRecord>;
        };
        const validation = validateOffloadResult(payload, envelope.payload.requestId);
        if (!validation.ok) {
          return { ok: false, status: 502, error: validation.error };
        }
        return { ok: true, body: payload };
      } catch {
        return { ok: false, status: 502, error: 'router-offload-unreachable' };
      }
    }

    return { ok: false, status: 503, error: 'offload-unavailable' };
  };

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = req.url || '';
      if (url.startsWith('/admin/')) {
        return adminHandler(req, res);
      }

      if (config.setupMode && url !== '/health' && url !== '/status') {
        return sendJson(res, 503, {
          error: 'service-unconfigured',
          details: 'The service is in Setup Mode. Please use the Admin Dashboard to configure it.',
        });
      }

      const requestId = randomUUID();
    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && req.url === '/status') {
      const health = await service.runner.health();
      return sendJson(res, 200, {
        ok: true,
        uptimeMs: Date.now() - startedAtMs,
        nodeId: config.nodeId,
        runner: {
          name: config.runnerName,
          health,
        },
        inFlight: service.inFlight,
        capacity: {
          maxConcurrent: config.capacityMaxConcurrent,
          currentLoad: config.capacityCurrentLoad + service.inFlight,
        },
        payments: {
          requirePayment: config.requirePayment,
          verificationEnabled: Boolean(config.paymentVerification),
        },
      });
    }

    if (req.method === 'GET' && req.url === '/metrics') {
      const metrics = await nodeRegistry.metrics();
      res.setHeader('content-type', nodeRegistry.contentType);
      res.end(metrics);
      return;
    }

    if (req.method === 'POST' && req.url === '/offload/rfb') {
      if (!config.offloadAuctionEnabled) {
        return sendJson(res, 403, { error: 'offload-auction-disabled' });
      }
      const body = await readJsonBody(req, config.maxRequestBytes);
      if (!body.ok) {
        return sendJson(res, 400, { error: body.error });
      }
      const validation = validateEnvelope(body.value, validateNodeRfbPayload);
      if (!validation.ok) {
        return sendJson(res, 400, { error: 'invalid-envelope', details: validation.errors });
      }
      const envelope = body.value as Envelope<NodeRfbPayload>;
      if (!isNostrNpub(envelope.keyId)) {
        return sendJson(res, 400, { error: 'invalid-key-id' });
      }
      if (
        config.offloadAuctionAllowList?.length &&
        !config.offloadAuctionAllowList.includes(envelope.keyId)
      ) {
        return sendJson(res, 403, { error: 'offload-auction-not-allowed' });
      }
      if (!checkAuctionRateLimit(envelope.keyId)) {
        return sendJson(res, 429, { error: 'offload-auction-rate-limit' });
      }
      const senderKey = parsePublicKey(envelope.keyId);
      if (!verifyEnvelope(envelope, senderKey)) {
        return sendJson(res, 401, { error: 'invalid-signature' });
      }
      const replay = checkReplay(envelope, store);
      if (!replay.ok) {
        return sendJson(res, 400, { error: replay.error });
      }
      if (!config.privateKey) {
        return sendJson(res, 500, { error: 'node-private-key-missing' });
      }
      const currentLoad = config.capacityCurrentLoad + service.inFlight;
      if (config.capacityMaxConcurrent <= 0 || currentLoad >= config.capacityMaxConcurrent) {
        return sendJson(res, 409, { error: 'node-saturated' });
      }
      const baseLatency = config.capabilityLatencyMs ?? 750;
      const etaMs = baseLatency + Math.max(0, currentLoad) * baseLatency;
      const bidPayload: NodeBidPayload = {
        requestId: envelope.payload.requestId,
        nodeId: config.nodeId,
        etaMs,
        bidExpiryMs: Date.now() + Math.max(200, config.offloadAuctionMs ?? 800),
      };
      const bidEnvelope = signEnvelope(
        buildEnvelope(bidPayload, randomUUID(), Date.now(), config.keyId),
        config.privateKey,
      );
      return sendJson(res, 200, bidEnvelope);
    }

    if (req.method === 'POST' && req.url === '/offload/award') {
      if (!config.offloadAuctionEnabled) {
        return sendJson(res, 403, { error: 'offload-auction-disabled' });
      }
      const body = await readJsonBody(req, config.maxRequestBytes);
      if (!body.ok) {
        return sendJson(res, 400, { error: body.error });
      }
      const validation = validateEnvelope(body.value, validateNodeAwardPayload);
      if (!validation.ok) {
        return sendJson(res, 400, { error: 'invalid-envelope', details: validation.errors });
      }
      const envelope = body.value as Envelope<NodeAwardPayload>;
      if (!isNostrNpub(envelope.keyId)) {
        return sendJson(res, 400, { error: 'invalid-key-id' });
      }
      if (
        config.offloadAuctionAllowList?.length &&
        !config.offloadAuctionAllowList.includes(envelope.keyId)
      ) {
        return sendJson(res, 403, { error: 'offload-auction-not-allowed' });
      }
      if (!checkAuctionRateLimit(envelope.keyId)) {
        return sendJson(res, 429, { error: 'offload-auction-rate-limit' });
      }
      const senderKey = parsePublicKey(envelope.keyId);
      if (!verifyEnvelope(envelope, senderKey)) {
        return sendJson(res, 401, { error: 'invalid-signature' });
      }
      const replay = checkReplay(envelope, store);
      if (!replay.ok) {
        return sendJson(res, 400, { error: replay.error });
      }
      if (envelope.payload.winnerKeyId !== config.keyId) {
        return sendJson(res, 403, { error: 'award-not-for-node' });
      }
      const currentLoad = config.capacityCurrentLoad + service.inFlight;
      if (config.capacityMaxConcurrent <= 0 || currentLoad >= config.capacityMaxConcurrent) {
        return sendJson(res, 409, { error: 'node-saturated' });
      }
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && req.url === '/infer/stream') {
      const span = nodeTracer.startSpan('node.inferStream', {
        attributes: { component: 'node', 'node.id': config.nodeId, 'request.id': requestId },
      });
      const timer = nodeInferenceDuration.startTimer();
      let statusLabel = '200';
      let inFlightRegistered = false;
      let envelope: Envelope<InferenceRequest> | null = null;
      let streaming = false;
      let requestClosed = false;
      const markClosed = () => {
        requestClosed = true;
      };
      const cleanup = () => {
        req.off('aborted', markClosed);
        res.off('close', markClosed);
      };
      req.on('aborted', markClosed);
      res.on('close', markClosed);
      res.on('finish', cleanup);
      res.on('close', cleanup);
      const respond = (status: number, body: unknown): void => {
        statusLabel = status.toString();
        span.setAttribute('http.status_code', status);
        sendJson(res, status, body);
      };
      const streamError = (error: string, details?: unknown): void => {
        sendSseEvent(res, 'error', { error, details });
        res.end();
      };
      const streamFinal = (
        responseEnvelope: Envelope<InferenceResponse>,
        meteringEnvelope: Envelope<MeteringRecord>,
      ): void => {
        sendSseEvent(res, 'final', { response: responseEnvelope, metering: meteringEnvelope });
        res.end();
      };
      try {
        const body = await readJsonBody(req, config.maxRequestBytes);
        if (!body.ok) {
          const status = body.error === 'payload-too-large' ? 413 : 400;
          return respond(status, { error: body.error });
        }

        const validation = await validateSignedEnvelope<InferenceRequest>(
          body.value,
          'InferenceRequest',
          validateInferenceRequest,
          envelopeWorkerPool,
          selectRouterPublicKeyHex(config, body.value),
        );
        if (!validation.ok) {
          return respond(validation.status, {
            error: validation.error,
            details: validation.details,
          });
        }

        envelope = validation.envelope;
        if (config.routerKeyId === envelope.keyId && !config.routerPublicKey) {
          return respond(500, { error: 'router-public-key-missing' });
        }
        const access = checkRouterAccess(config, envelope.keyId);
        if (!access.ok) {
          return respond(access.status, { error: access.error });
        }
        const rateLimit = checkIngressRateLimit(envelope.keyId);
        if (!rateLimit.ok) {
          return respond(rateLimit.status, { error: rateLimit.error });
        }
        const promptBytes = Buffer.byteLength(envelope.payload.prompt, 'utf8');
        if (config.maxPromptBytes !== undefined && promptBytes > config.maxPromptBytes) {
          return respond(413, { error: 'prompt-too-large' });
        }
        if (config.maxTokens !== undefined && envelope.payload.maxTokens > config.maxTokens) {
          return respond(400, { error: 'max-tokens-exceeded' });
        }
        const contextCheck = await checkContextWindow(
          envelope.payload.modelId,
          envelope.payload.prompt,
          envelope.payload.maxTokens,
        );
        if (!contextCheck.ok) {
          return respond(400, { error: contextCheck.error });
        }
        const replay = checkReplay(envelope, store);
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
          if (receipt.payload.splits && receipt.payload.splits.length > 0) {
            const splitTotal = sumSplits(receipt.payload.splits);
            if (splitTotal !== receipt.payload.amountSats) {
              nodeReceiptFailures.inc();
              return respond(400, { error: 'payment-split-total-mismatch' });
            }
            const routerFeeSats = routerFeeFromSplits(receipt.payload.splits);
            const nodeAmountSats = nodeAmountFromSplits(receipt.payload.splits);
            if (
              config.routerFeeMaxSats !== undefined &&
              routerFeeSats > config.routerFeeMaxSats
            ) {
              nodeReceiptFailures.inc();
              return respond(400, { error: 'router-fee-exceeds-cap' });
            }
            if (
              config.routerFeeMaxBps !== undefined &&
              routerFeeSats >
                Math.floor(((nodeAmountSats || receipt.payload.amountSats) * config.routerFeeMaxBps) / 10_000)
            ) {
              nodeReceiptFailures.inc();
              return respond(400, { error: 'router-fee-exceeds-cap' });
            }
          }

          const clientKey = parsePublicKey(receipt.keyId);
          if (!verifyEnvelope(receipt, clientKey)) {
            nodeReceiptFailures.inc();
            return respond(401, { error: 'invalid-payment-receipt-signature' });
          }

          const verification = await verifyPaymentReceipt(
            receipt.payload,
            config.paymentVerification,
          );
          if (!verification.ok) {
            nodeReceiptFailures.inc();
            return respond(400, { error: verification.error });
          }
        }

        if (!config.privateKey) {
          return respond(500, { error: 'node-private-key-missing' });
        }

        const currentLoad = config.capacityCurrentLoad + service.inFlight;
        if (config.capacityMaxConcurrent <= 0 || currentLoad >= config.capacityMaxConcurrent) {
          const offload = await attemptOffload(envelope);
          if (offload.ok) {
            startSse(res);
            streaming = true;
            streamFinal(offload.body.response, offload.body.metering);
            return;
          }
          return respond(offload.status, { error: offload.error });
        }
        service.inFlight += 1;
        inFlightRegistered = true;

        startSse(res);
        streaming = true;
        const startMs = Date.now();
        const deadlineMs = config.maxInferenceMs ? startMs + config.maxInferenceMs : undefined;
        let output = '';
        let chunkIndex = 0;
        let responsePayload: InferenceResponse | null = null;

        if (service.runner.inferStream) {
          for await (const chunk of service.runner.inferStream(envelope.payload)) {
            if (requestClosed) {
              if (!res.writableEnded) {
                res.end();
              }
              return;
            }
            if (deadlineMs !== undefined && Date.now() > deadlineMs) {
              throw new Error('runner-timeout');
            }
            output += chunk.delta;
            sendSseEvent(res, 'chunk', {
              requestId: envelope.payload.requestId,
              modelId: envelope.payload.modelId,
              delta: chunk.delta,
              index: chunkIndex,
            });
            chunkIndex += 1;
          }
        } else {
          responsePayload = config.maxInferenceMs
            ? await Promise.race([
                service.runner.infer(envelope.payload),
                new Promise<InferenceResponse>((_, reject) =>
                  setTimeout(() => reject(new Error('runner-timeout')), config.maxInferenceMs),
                ),
              ])
            : await service.runner.infer(envelope.payload);
          output = responsePayload.output;
          sendSseEvent(res, 'chunk', {
            requestId: responsePayload.requestId,
            modelId: responsePayload.modelId,
            delta: responsePayload.output,
            index: 0,
          });
        }

        if (!responsePayload) {
          responsePayload = {
            requestId: envelope.payload.requestId,
            modelId: envelope.payload.modelId,
            output,
            usage: {
              inputTokens: contextCheck.inputTokensEstimate,
              outputTokens: estimateTokensFromText(output),
            },
            latencyMs: Date.now() - startMs,
          };
        }

        const responseEnvelope = signEnvelope(
          buildEnvelope(responsePayload, randomUUID(), Date.now(), config.keyId),
          config.privateKey,
        );

        const metering: MeteringRecord = {
          requestId: responsePayload.requestId,
          nodeId: config.nodeId,
          modelId: responsePayload.modelId,
          promptHash: hashPrompt(envelope.payload.prompt),
          inputTokens: responsePayload.usage.inputTokens,
          outputTokens: responsePayload.usage.outputTokens,
          wallTimeMs: responsePayload.latencyMs,
          bytesIn: Buffer.byteLength(envelope.payload.prompt, 'utf8'),
          bytesOut: Buffer.byteLength(responsePayload.output, 'utf8'),
          ts: Date.now(),
        };

        const meteringEnvelope = signEnvelope(
          buildEnvelope(metering, randomUUID(), Date.now(), config.keyId),
          config.privateKey,
        );

        streamFinal(responseEnvelope, meteringEnvelope);
      } catch (error) {
        logWarn('[node] runner error', {
          requestId: envelope?.payload?.requestId,
          error,
        });
        if (streaming) {
          const message =
            config.exposeErrors && error instanceof Error ? error.message : undefined;
          streamError('internal-error', message);
          return;
        }
        if (error instanceof Error && error.message === 'runner-timeout') {
          if (envelope) {
            const offload = await attemptOffload(envelope);
            if (offload.ok) {
              startSse(res);
              streaming = true;
              streamFinal(offload.body.response, offload.body.metering);
              return;
            }
          }
          return respond(504, { error: 'runner-timeout' });
        }
        if (envelope) {
          const offload = await attemptOffload(envelope);
          if (offload.ok) {
            startSse(res);
            streaming = true;
            streamFinal(offload.body.response, offload.body.metering);
            return;
          }
        }
        const message =
          config.exposeErrors && error instanceof Error ? error.message : undefined;
        return respond(500, {
          error: 'internal-error',
          details: message ? [message] : undefined,
        });
      } finally {
        if (inFlightRegistered) {
          service.inFlight = Math.max(0, service.inFlight - 1);
        }
        timer();
        nodeInferenceRequests.labels(statusLabel).inc();
        span.end();
      }
      return;
    }

    if (req.method === 'POST' && req.url === '/infer') {
      const span = nodeTracer.startSpan('node.infer', {
        attributes: { component: 'node', 'node.id': config.nodeId, 'request.id': requestId },
      });
      const timer = nodeInferenceDuration.startTimer();
      let statusLabel = '200';
      let inFlightRegistered = false;
      let envelope: Envelope<InferenceRequest> | null = null;
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

        const validation = await validateSignedEnvelope<InferenceRequest>(
          body.value,
          'InferenceRequest',
          validateInferenceRequest,
          envelopeWorkerPool,
          selectRouterPublicKeyHex(config, body.value),
        );
        if (!validation.ok) {
          return respond(validation.status, {
            error: validation.error,
            details: validation.details,
          });
        }

        envelope = validation.envelope;
        if (config.routerKeyId === envelope.keyId && !config.routerPublicKey) {
          return respond(500, { error: 'router-public-key-missing' });
        }
        const access = checkRouterAccess(config, envelope.keyId);
        if (!access.ok) {
          return respond(access.status, { error: access.error });
        }
        const rateLimit = checkIngressRateLimit(envelope.keyId);
        if (!rateLimit.ok) {
          return respond(rateLimit.status, { error: rateLimit.error });
        }
        const promptBytes = Buffer.byteLength(envelope.payload.prompt, 'utf8');
        if (config.maxPromptBytes !== undefined && promptBytes > config.maxPromptBytes) {
          return respond(413, { error: 'prompt-too-large' });
        }
        if (config.maxTokens !== undefined && envelope.payload.maxTokens > config.maxTokens) {
          return respond(400, { error: 'max-tokens-exceeded' });
        }
        const contextCheck = await checkContextWindow(
          envelope.payload.modelId,
          envelope.payload.prompt,
          envelope.payload.maxTokens,
        );
        if (!contextCheck.ok) {
          return respond(400, { error: contextCheck.error });
        }
        const replay = checkReplay(envelope, store);
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
          if (receipt.payload.splits && receipt.payload.splits.length > 0) {
            const splitTotal = sumSplits(receipt.payload.splits);
            if (splitTotal !== receipt.payload.amountSats) {
              nodeReceiptFailures.inc();
              return respond(400, { error: 'payment-split-total-mismatch' });
            }
            const routerFeeSats = routerFeeFromSplits(receipt.payload.splits);
            const nodeAmountSats = nodeAmountFromSplits(receipt.payload.splits);
            if (
              config.routerFeeMaxSats !== undefined &&
              routerFeeSats > config.routerFeeMaxSats
            ) {
              nodeReceiptFailures.inc();
              return respond(400, { error: 'router-fee-exceeds-cap' });
            }
            if (
              config.routerFeeMaxBps !== undefined &&
              routerFeeSats >
                Math.floor(((nodeAmountSats || receipt.payload.amountSats) * config.routerFeeMaxBps) / 10_000)
            ) {
              nodeReceiptFailures.inc();
              return respond(400, { error: 'router-fee-exceeds-cap' });
            }
          }

          const clientKey = parsePublicKey(receipt.keyId);
          if (!verifyEnvelope(receipt, clientKey)) {
            nodeReceiptFailures.inc();
            return respond(401, { error: 'invalid-payment-receipt-signature' });
          }

          const verification = await verifyPaymentReceipt(
            receipt.payload,
            config.paymentVerification,
          );
          if (!verification.ok) {
            nodeReceiptFailures.inc();
            return respond(400, { error: verification.error });
          }
        }

        if (!config.privateKey) {
          return respond(500, { error: 'node-private-key-missing' });
        }

        const currentLoad = config.capacityCurrentLoad + service.inFlight;
        if (config.capacityMaxConcurrent <= 0 || currentLoad >= config.capacityMaxConcurrent) {
          const offload = await attemptOffload(envelope);
          if (offload.ok) {
            return respond(200, offload.body);
          }
          return respond(offload.status, { error: offload.error });
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
        logWarn('[node] runner error', {
          requestId: envelope?.payload?.requestId,
          error,
        });
        if (error instanceof Error && error.message === 'runner-timeout') {
          if (envelope) {
            const offload = await attemptOffload(envelope);
            if (offload.ok) {
              return respond(200, offload.body);
            }
          }
          return respond(504, { error: 'runner-timeout' });
        }
        if (envelope) {
          const offload = await attemptOffload(envelope);
          if (offload.ok) {
            return respond(200, offload.body);
          }
        }
        const message =
          config.exposeErrors && error instanceof Error ? error.message : undefined;
        return respond(500, {
          error: 'internal-error',
          details: message ? [message] : undefined,
        });
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
    } catch (error) {
      logWarn('[node] uncaught error in handler', error);
      return sendJson(res, 500, { error: 'internal-error' });
    }
  };

  if (config.tls) {
    const tlsOptions: https.ServerOptions = {
      key: readFileSync(config.tls.keyPath),
      cert: readFileSync(config.tls.certPath),
    };
    if (config.tls.caPath) {
      tlsOptions.ca = readFileSync(config.tls.caPath);
    }
    if (config.tls.requireClientCert) {
      tlsOptions.requestCert = true;
      tlsOptions.rejectUnauthorized = true;
    }
    return https.createServer(tlsOptions, handler);
  }

  return http.createServer(handler);
};
