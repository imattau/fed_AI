import http, { IncomingMessage, ServerResponse } from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import {
  buildEnvelope,
  checkReplay,
  FileNonceStore,
  InMemoryNonceStore,
  NonceStore,
  isNostrNpub,
  parsePublicKey,
  signEnvelope,
  signRouterReceipt,
  validateEnvelope,
  validateInferenceRequest,
  validateInferenceResponse,
  validateMeteringRecord,
  validateNodeDescriptor,
  validateNodeOffloadRequest,
  validatePaymentReceipt,
  validateRouterAwardPayload,
  validateRouterBidPayload,
  validateRouterCapabilityProfile,
  validateRouterControlMessage,
  validateRouterJobResult,
  validateRouterJobSubmit,
  validateRouterReceipt,
  validateRouterPriceSheet,
  validateRouterRfbPayload,
  validateRouterStatusPayload,
  validateStakeCommit,
  validateStakeSlash,
  validateQuoteRequest,
  verifyEnvelope,
  signRouterMessage,
  verifyRouterMessage,
  verifyRouterReceipt,
  estimateTokensFromText,
} from '@fed-ai/protocol';
import { RelayDiscoverySnapshot, verifyManifest } from '@fed-ai/manifest';
import { effectiveStakeUnits, recordCommit, recordSlash } from './accounting/staking';
import type {
  Capability,
  Envelope,
  InferenceRequest,
  InferenceResponse,
  MeteringRecord,
  NodeDescriptor,
  NodeOffloadRequest,
  PayeeType,
  PaymentSplit,
  PaymentReceipt,
  PaymentRequest,
  QuoteRequest,
  QuoteResponse,
  RouterAwardPayload,
  RouterBidPayload,
  RouterCapabilityProfile,
  RouterControlMessage,
  RouterJobResult,
  RouterJobSubmit,
  RouterPrivacyLevel,
  RouterReceipt,
  RouterPriceSheet,
  RouterRfbPayload,
  RouterStatusPayload,
} from '@fed-ai/protocol';
import type { NodeManifest } from '@fed-ai/manifest';
import { defaultRelayAdmissionPolicy, RelayAdmissionPolicy, RouterConfig } from './config';
import type { RouterService } from './server';
import { scoreNode, selectNode } from './scheduler';
import { estimatePrice } from './scheduler/score';
import { logWarn } from './logging';
import { checkClientAccess } from './authz';
import { verifyPaymentReceipt } from './payments/verify';
import { requestInvoice } from './payments/invoice';
import {
  recordManifest,
  recordManifestAdmission,
  recordPaymentReceipt,
  recordPaymentRequest,
  registerNode,
} from './server';
import { discoverFederationPeers } from './federation/discovery';
import { runAuctionAndAward } from './federation/publisher';
import { allowsPrivacyLevel, canBidForRfb, estimateBidPrice } from './federation/logic';
import type { FederationRateLimiter } from './federation/rate-limit';
import type { RateLimiter } from './rate-limit';
import { createEnvelopeWorkerPool } from './workers/envelope-worker-pool';
import type { EnvelopeWorkerPool } from './workers/envelope-worker-pool';
import type { EnvelopeValidatorName } from './workers/types';
import {
  inferenceDuration,
  inferenceRequests,
  paymentReceiptFailures,
  paymentRequests,
  routerRegistry,
  routerTracer,
  nodeFailureEvents,
  accountingFailures,
  federationMessages,
  federationJobs,
} from './observability';
import { validateEndpoint } from './security';
import { createAdminHandler } from './admin';

const NODE_HEARTBEAT_WINDOW_MS = 30_000;
const PAYMENT_WINDOW_MS = 5 * 60 * 1000;
const NODE_FAILURE_THRESHOLD = 3;
const NODE_FAILURE_BASE_COOLDOWN_MS = 30_000;
const NODE_FAILURE_BACKOFF_CAP = 4;
const NODE_RELIABILITY_SAMPLE_MIN = 5;
const NODE_RELIABILITY_MAX_PENALTY = 20;
const NODE_PERFORMANCE_SAMPLE_MIN = 10;
const NODE_PERFORMANCE_BASELINE = 0.9;
const NODE_PERFORMANCE_MAX_BONUS = 10;
const MANIFEST_DECAY_SAMPLES = 20;
const RELAY_DISCOVERY_CLOCK_SKEW_MS = 5 * 60 * 1000;
const FEDERATION_AUCTION_EXPIRY_MS = 1500;
const FEDERATION_JOB_RUNTIME_MS = 10_000;
const FEDERATION_JOB_RETURN_PATH = '/federation/job-result';

const computeRouterFeeSats = (amountSats: number, config: RouterConfig): number => {
  if (!config.routerFeeEnabled || !config.routerFeeSplitEnabled) {
    return 0;
  }
  const bps = Math.max(0, config.routerFeeBps ?? 0);
  const flat = Math.max(0, config.routerFeeFlatSats ?? 0);
  let fee = Math.round((amountSats * bps) / 10_000 + flat);
  if (config.routerFeeMinSats !== undefined) {
    fee = Math.max(config.routerFeeMinSats, fee);
  }
  if (config.routerFeeMaxSats !== undefined) {
    fee = Math.min(config.routerFeeMaxSats, fee);
  }
  return Math.max(0, fee);
};

const normalizeSplits = (splits?: PaymentSplit[]): PaymentSplit[] => {
  return (splits ?? []).slice().sort((a, b) => {
    const keyA = `${a.payeeType}:${a.payeeId}:${a.amountSats}:${a.role ?? ''}`;
    const keyB = `${b.payeeType}:${b.payeeId}:${b.amountSats}:${b.role ?? ''}`;
    return keyA.localeCompare(keyB);
  });
};

const splitsMatch = (expected?: PaymentSplit[], actual?: PaymentSplit[]): boolean => {
  if (!expected || expected.length === 0) {
    return !actual || actual.length === 0;
  }
  if (!actual || actual.length !== expected.length) {
    return false;
  }
  const sortedExpected = normalizeSplits(expected);
  const sortedActual = normalizeSplits(actual);
  return sortedExpected.every((split, index) => {
    const candidate = sortedActual[index];
    return (
      split.payeeType === candidate.payeeType &&
      split.payeeId === candidate.payeeId &&
      split.amountSats === candidate.amountSats &&
      split.role === candidate.role
    );
  });
};

const getNodeHealth = (service: RouterService, nodeId: string) => {
  const existing = service.nodeHealth.get(nodeId);
  if (existing) {
    return existing;
  }
  const entry = {
    successes: 0,
    failures: 0,
    consecutiveFailures: 0,
    lastFailureMs: 0,
    lastSuccessMs: 0,
  };
  service.nodeHealth.set(nodeId, entry);
  return entry;
};

const assessRelayDiscoverySnapshot = (
  snapshot: RelayDiscoverySnapshot | null | undefined,
  policy: RelayAdmissionPolicy,
): { eligible: boolean; reason?: string } => {
  if (!snapshot) {
    return policy.requireSnapshot ? { eligible: false, reason: 'missing-relay-discovery' } : { eligible: true };
  }

  if (!snapshot.discoveredAtMs || Number.isNaN(snapshot.discoveredAtMs)) {
    return { eligible: false, reason: 'relay-discovery-missing-timestamp' };
  }

  const now = Date.now();
  if (snapshot.discoveredAtMs > now + RELAY_DISCOVERY_CLOCK_SKEW_MS) {
    return { eligible: false, reason: 'relay-discovery-future-timestamp' };
  }
  if (now - snapshot.discoveredAtMs > policy.maxAgeMs) {
    return { eligible: false, reason: 'relay-discovery-expired' };
  }

  if (!snapshot.relays || snapshot.relays.length === 0) {
    return { eligible: false, reason: 'relay-discovery-empty' };
  }

  if (policy.minScore !== undefined) {
    if (snapshot.options.minScore === undefined || snapshot.options.minScore < policy.minScore) {
      return { eligible: false, reason: 'relay-discovery-min-score-too-low' };
    }
  }

  if (policy.maxResults !== undefined) {
    if (
      snapshot.options.maxResults === undefined ||
      snapshot.options.maxResults > policy.maxResults
    ) {
      return { eligible: false, reason: 'relay-discovery-max-results-too-high' };
    }
  }

  if (snapshot.options.minScore !== undefined) {
    const hasLowScore = snapshot.relays.some((relay) => relay.score < snapshot.options.minScore!);
    if (hasLowScore) {
      return { eligible: false, reason: 'relay-discovery-score-mismatch' };
    }
  }

  if (
    snapshot.options.maxResults !== undefined &&
    snapshot.relays.length > snapshot.options.maxResults
  ) {
    return { eligible: false, reason: 'relay-discovery-exceeds-max-results' };
  }

  return { eligible: true };
};

const markNodeFailure = (service: RouterService, nodeId: string): void => {
  const entry = getNodeHealth(service, nodeId);
  entry.failures += 1;
  entry.consecutiveFailures += 1;
  entry.lastFailureMs = Date.now();
  nodeFailureEvents.inc({ nodeId });
  if (entry.consecutiveFailures >= NODE_FAILURE_THRESHOLD) {
    const multiplier = Math.min(
      NODE_FAILURE_BACKOFF_CAP,
      entry.consecutiveFailures - NODE_FAILURE_THRESHOLD + 1,
    );
    service.nodeCooldown.set(nodeId, Date.now() + NODE_FAILURE_BASE_COOLDOWN_MS * multiplier);
  }
};

const recordNodeSuccess = (service: RouterService, nodeId: string): void => {
  const entry = getNodeHealth(service, nodeId);
  entry.successes += 1;
  entry.consecutiveFailures = 0;
  entry.lastSuccessMs = Date.now();
  service.nodeCooldown.delete(nodeId);
};

const failurePenalty = (service: RouterService, nodeId: string): number => {
  const entry = service.nodeHealth.get(nodeId);
  if (!entry) {
    return 0;
  }
  const total = entry.successes + entry.failures;
  const reliabilityPenalty =
    total >= NODE_RELIABILITY_SAMPLE_MIN
      ? Math.min(
          NODE_RELIABILITY_MAX_PENALTY,
          Math.round((entry.failures / total) * NODE_RELIABILITY_MAX_PENALTY),
        )
      : 0;
  const streakPenalty = Math.min(20, entry.consecutiveFailures * 5);
  return Math.min(30, reliabilityPenalty + streakPenalty);
};

const performanceBonus = (service: RouterService, nodeId: string): number => {
  const entry = service.nodeHealth.get(nodeId);
  if (!entry) {
    return 0;
  }
  const total = entry.successes + entry.failures;
  if (total < NODE_PERFORMANCE_SAMPLE_MIN) {
    return 0;
  }
  const successRate = entry.successes / total;
  const rawBonus = Math.round((successRate - NODE_PERFORMANCE_BASELINE) * 100);
  return Math.max(-NODE_PERFORMANCE_MAX_BONUS, Math.min(NODE_PERFORMANCE_MAX_BONUS, rawBonus));
};

const manifestDecayFactor = (service: RouterService, nodeId: string): number => {
  const entry = service.nodeHealth.get(nodeId);
  if (!entry) {
    return 1;
  }
  const total = entry.successes + entry.failures;
  if (total <= 0) {
    return 1;
  }
  const factor = 1 - Math.min(1, total / MANIFEST_DECAY_SAMPLES);
  return Math.max(0, factor);
};

const filterActiveNodes = (service: RouterService, nodes: NodeDescriptor[]): NodeDescriptor[] => {
  const cutoff = Date.now() - NODE_HEARTBEAT_WINDOW_MS;
  return nodes.filter((node) => {
    if (node.lastHeartbeatMs && node.lastHeartbeatMs < cutoff) {
      return false;
    }
    const cooldown = service.nodeCooldown.get(node.nodeId);
    return !cooldown || cooldown <= Date.now();
  });
};

const paymentKey = (requestId: string, payeeType: PayeeType, payeeId: string): string =>
  `${requestId}:${payeeType}:${payeeId}`;

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
    const admission = service.manifestAdmissions.get(node.nodeId);
    const baseTrust = node.trustScore ?? 0;
    const manifestTrust =
      manifest && (!admission || admission.eligible)
        ? Math.round(manifestScore(manifest) * manifestDecayFactor(service, node.nodeId))
        : 0;
    const stakeTrust = stakeScore(service, node.nodeId);
    const penalty = failurePenalty(service, node.nodeId);
    const performance = performanceBonus(service, node.nodeId);
    return {
      ...node,
      trustScore: Math.max(
        0,
        Math.min(100, baseTrust + manifestTrust + stakeTrust + performance - penalty),
      ),
    };
  });
};

const getWeightedNodes = (service: RouterService): NodeDescriptor[] => {
  const nowMs = Date.now();
  const cache = service.weightedNodesCache;
  if (cache && nowMs - cache.computedAtMs < 1000) {
    return cache.nodes;
  }
  const weighted = applyManifestWeights(service);
  service.weightedNodesCache = { computedAtMs: nowMs, nodes: weighted };
  return weighted;
};

const rankCandidateNodes = (
  nodes: NodeDescriptor[],
  request: QuoteRequest,
  topK: number | undefined,
): NodeDescriptor[] => {
  const limit = topK && topK > 0 ? topK : nodes.length;
  const ranked: Array<{ node: NodeDescriptor; score: number }> = [];
  for (const node of nodes) {
    const score = scoreNode(node, request);
    if (score === null) {
      continue;
    }
    let inserted = false;
    for (let i = 0; i < ranked.length; i += 1) {
      if (score > ranked[i].score) {
        ranked.splice(i, 0, { node, score });
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      ranked.push({ node, score });
    }
    if (ranked.length > limit) {
      ranked.length = limit;
    }
  }
  return ranked.map((entry) => entry.node);
};

const pickCapabilityForRequest = (
  node: NodeDescriptor,
  request: QuoteRequest,
): Capability | null => {
  if (!node.capabilities || node.capabilities.length === 0) {
    return null;
  }
  const requiredTokens = request.inputTokensEstimate + request.outputTokensEstimate;
  const matchesJobType = (capability: Capability): boolean => {
    if (!request.jobType) {
      return true;
    }
    if (!capability.jobTypes || capability.jobTypes.length === 0) {
      return false;
    }
    return capability.jobTypes.includes(request.jobType);
  };
  const fitsContextWindow = (capability: Capability): boolean => {
    if (!capability.contextWindow) {
      return true;
    }
    return requiredTokens <= capability.contextWindow;
  };
  if (request.modelId !== 'auto') {
    return (
      node.capabilities.find(
        (capability) =>
          capability.modelId === request.modelId &&
          matchesJobType(capability) &&
          fitsContextWindow(capability),
      ) ?? null
    );
  }
  let best: { cap: Capability; price: number } | null = null;
  for (const capability of node.capabilities) {
    if (!matchesJobType(capability) || !fitsContextWindow(capability)) {
      continue;
    }
    const price = estimatePrice(capability, request);
    if (!best || price < best.price) {
      best = { cap: capability, price };
    }
  }
  return best?.cap ?? null;
};

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

const bodyErrorStatus = (error: string): number => {
  return error === 'payload-too-large' ? 413 : 400;
};

const isEnvelopeLike = (value: unknown): value is Envelope<unknown> => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return ['payload', 'nonce', 'ts', 'keyId', 'sig'].every((key) => key in value);
};

const hashString = (value: string): string => {
  return createHash('sha256').update(value, 'utf8').digest('hex');
};

const buildFederationJobHash = (request: InferenceRequest, inputHash: string): string => {
  const descriptor = `${request.requestId}:${request.modelId}:${inputHash}:${request.maxTokens}`;
  return hashString(descriptor);
};

const parseSignedEnvelope = <T>(
  raw: unknown,
  validator: (value: unknown) => { ok: true } | { ok: false; errors: string[] },
  nonceStore: NonceStore,
): { ok: true; envelope: Envelope<T> } | { ok: false; error: string; details?: string[] } => {
  if (!isEnvelopeLike(raw)) {
    return { ok: false, error: 'missing-envelope' };
  }
  const validation = validateEnvelope(raw, validator);
  if (!validation.ok) {
    return { ok: false, error: 'invalid-envelope', details: validation.errors };
  }
  const envelope = raw as Envelope<T>;
  if (!isNostrNpub(envelope.keyId)) {
    return { ok: false, error: 'invalid-key-id' };
  }
  const replay = checkReplay(envelope, nonceStore);
  if (!replay.ok) {
    return { ok: false, error: replay.error ?? 'replay-error' };
  }
  const publicKey = parsePublicKey(envelope.keyId);
  if (!verifyEnvelope(envelope, publicKey)) {
    return { ok: false, error: 'invalid-signature' };
  }
  return { ok: true, envelope };
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

const parseInferencePayload = (
  payload: string,
): { ok: true; request: InferenceRequest } | { ok: false } => {
  try {
    const parsed = JSON.parse(payload) as InferenceRequest;
    const validation = validateInferenceRequest(parsed);
    if (!validation.ok) {
      return { ok: false };
    }
    return { ok: true, request: parsed };
  } catch {
    return { ok: false };
  }
};

const verifyFederationMessage = <T>(
  raw: unknown,
  validator: (value: unknown) => { ok: true } | { ok: false; errors: string[] },
): { ok: true; message: RouterControlMessage<T> } | { ok: false; error: string; details?: string[] } => {
  const validation = validateRouterControlMessage(raw, validator);
  if (!validation.ok) {
    return { ok: false, error: 'invalid-message', details: validation.errors };
  }
  const message = raw as RouterControlMessage<T>;
  if (!isNostrNpub(message.routerId)) {
    return { ok: false, error: 'invalid-key-id' };
  }
  if (message.expiry < Date.now()) {
    return { ok: false, error: 'message-expired' };
  }
  return { ok: true, message };
};


export const createRouterHttpServer = (
  service: RouterService,
  config: RouterConfig,
  nonceStore?: NonceStore,
  federationRateLimiter?: FederationRateLimiter,
  ingressRateLimiter?: RateLimiter | null,
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
  const startedAtMs = Date.now();
  const federationPeers = discoverFederationPeers(
    config.federation?.peers,
    config.federation?.discovery?.bootstrapPeers,
  ).map((peer) => peer.url);
  const getPeerRestriction = (routerId: string): 'blocked' | 'muted' | 'not-allowed' | null => {
    if (config.federation?.nostrAllowedPeers?.length) {
      if (!config.federation.nostrAllowedPeers.includes(routerId)) {
        return 'not-allowed';
      }
    }
    if (config.federation?.nostrBlockPeers?.includes(routerId)) {
      return 'blocked';
    }
    if (config.federation?.nostrMutePeers?.includes(routerId)) {
      return 'muted';
    }
    return null;
  };

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

  const ensureRequestId = (req: IncomingMessage, res: ServerResponse): string => {
    const header = req.headers['x-request-id'];
    const requestId = Array.isArray(header) ? header[0] : header ?? randomUUID();
    res.setHeader('x-request-id', requestId);
    return requestId;
  };

  const attemptFederationOffload = async (
    envelope: Envelope<InferenceRequest>,
  ): Promise<
    | {
        ok: true;
        body: { response: Envelope<InferenceResponse>; metering: Envelope<MeteringRecord> };
      }
    | { ok: false; status: number; error: string }
  > => {
    if (!config.federation?.enabled || !config.privateKey) {
      return { ok: false, status: 503, error: 'federation-disabled' };
    }
    if (federationPeers.length === 0) {
      return { ok: false, status: 503, error: 'no-federation-peers' };
    }
    if (
      config.federation.maxOffloads !== undefined &&
      service.federation.outboundJobs.size >= config.federation.maxOffloads
    ) {
      return { ok: false, status: 429, error: 'federation-offload-cap' };
    }

    const inputHash = hashString(envelope.payload.prompt);
    const promptTokensEstimate = estimateTokensFromText(envelope.payload.prompt);
    const promptBytes = Buffer.byteLength(envelope.payload.prompt, 'utf8');
    const privacyLevel = (config.federation.maxPrivacyLevel ?? 'PL1') as RouterPrivacyLevel;
    const rfbPayload: RouterRfbPayload = {
      jobId: envelope.payload.requestId,
      jobType: 'GEN_CHUNK',
      privacyLevel,
      sizeEstimate: {
        tokens: promptTokensEstimate + envelope.payload.maxTokens,
        bytes: promptBytes,
      },
      deadlineMs: Date.now() + FEDERATION_AUCTION_EXPIRY_MS,
      maxPriceMsat: config.federation.maxSpendMsat ?? 10_000,
      requiredCaps: { modelId: envelope.payload.modelId },
      validationMode: 'HASH_ONLY',
      transportHint: 'https',
      payloadDescriptor: { type: 'inference' },
      jobHash: buildFederationJobHash(envelope.payload, inputHash),
    };
    const rfbMessage: RouterControlMessage<RouterRfbPayload> = signRouterMessage(
      {
        type: 'RFB',
        version: '0.1',
        routerId: config.keyId,
        messageId: `${config.keyId}:${rfbPayload.jobId}:${Date.now()}`,
        timestamp: Date.now(),
        expiry: Date.now() + FEDERATION_AUCTION_EXPIRY_MS,
        payload: rfbPayload,
        sig: '',
      },
      config.privateKey,
    );

    const { award, winnerPeer } = await runAuctionAndAward(config, federationPeers, rfbMessage);
    if (!award || !winnerPeer) {
      return { ok: false, status: 503, error: 'no-federation-bids' };
    }

    const submit: RouterJobSubmit = {
      jobId: envelope.payload.requestId,
      jobType: rfbPayload.jobType,
      privacyLevel,
      payload: JSON.stringify(envelope.payload),
      inputHash,
      maxCostMsat: award.payload.acceptedPriceMsat,
      maxRuntimeMs: FEDERATION_JOB_RUNTIME_MS,
      returnEndpoint: `${config.endpoint}${FEDERATION_JOB_RETURN_PATH}`,
    };
    const submitEnvelope = signEnvelope(
      buildEnvelope(submit, randomUUID(), Date.now(), config.keyId),
      config.privateKey,
    );
    service.federation.outboundAwards.set(submit.jobId, award);
    service.federation.outboundJobs.set(submit.jobId, {
      submit,
      award,
      peer: winnerPeer,
      updatedAtMs: Date.now(),
      settlement: {},
    });

    let response: Response;
    try {
      response = await fetch(`${winnerPeer}/federation/job-submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(submitEnvelope),
      });
    } catch (error) {
      return { ok: false, status: 502, error: 'federation-submit-failed' };
    }
    if (!response.ok) {
      return { ok: false, status: 502, error: 'federation-submit-rejected' };
    }

    const body = (await response.json()) as {
      response?: Envelope<InferenceResponse>;
      metering?: Envelope<MeteringRecord>;
      receipt?: RouterReceipt;
    };
    if (!body.response || !body.metering || !body.receipt) {
      return { ok: false, status: 502, error: 'federation-response-missing' };
    }
    const responseValidation = validateEnvelope(body.response, validateInferenceResponse);
    if (!responseValidation.ok) {
      return { ok: false, status: 502, error: 'federation-response-invalid' };
    }
    const meteringValidation = validateEnvelope(body.metering, validateMeteringRecord);
    if (!meteringValidation.ok) {
      return { ok: false, status: 502, error: 'federation-metering-invalid' };
    }
    const nodeKey = parsePublicKey(body.response.keyId);
    if (!verifyEnvelope(body.response, nodeKey) || !verifyEnvelope(body.metering, nodeKey)) {
      return { ok: false, status: 502, error: 'federation-signature-invalid' };
    }
    const receiptValidation = validateRouterReceipt(body.receipt);
    if (!receiptValidation.ok) {
      return { ok: false, status: 502, error: 'federation-receipt-invalid' };
    }
    const workerKey = parsePublicKey(body.receipt.workerRouterId);
    if (!verifyRouterReceipt(body.receipt, workerKey)) {
      return { ok: false, status: 502, error: 'federation-receipt-signature' };
    }

    const job = service.federation.outboundJobs.get(submit.jobId);
    if (job) {
      job.updatedAtMs = Date.now();
      job.result = {
        jobId: submit.jobId,
        resultPayload: body.response.payload.output,
        outputHash: body.receipt.outputHash ?? hashString(body.response.payload.output),
        usage: body.receipt.usage,
        resultStatus: body.receipt.status,
        receipt: body.receipt,
      };
      job.settlement = { ...(job.settlement ?? {}), receipt: body.receipt };
    }
    return { ok: true, body: { response: body.response, metering: body.metering } };
  };

  const attemptNodeInference = async ({
    targetNode,
    payload,
    nonce,
    expectedRequestId,
    allowDelegation,
  }: {
    targetNode: NodeDescriptor;
    payload: InferenceRequest;
    nonce: string;
    expectedRequestId: string;
    allowDelegation: boolean;
  }): Promise<
    | { ok: true; body: { response: Envelope<InferenceResponse>; metering: Envelope<MeteringRecord> } }
    | { ok: false; status: number; body: { error: string; details?: string[] } }
  > => {
    if (!config.privateKey) {
      return { ok: false, status: 500, body: { error: 'router-private-key-missing' } };
    }
    const forwardEnvelope = signEnvelope(
      buildEnvelope(payload, nonce, Date.now(), config.keyId),
      config.privateKey,
    );

    const failNode = (
      status: number,
      body: { error: string; details?: string[] },
      reason?: string,
    ): { ok: false; status: number; body: { error: string; details?: string[] } } => {
      markNodeFailure(service, targetNode.nodeId);
      if (reason) {
        accountingFailures.inc({ reason });
        logWarn(`[router] accounting failure (${reason}) for node ${targetNode.nodeId}`);
      }
      return { ok: false, status, body };
    };

    let nodeResponse: Response;
    try {
      nodeResponse = await fetch(`${targetNode.endpoint}/infer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(forwardEnvelope),
      });
    } catch (error) {
      return failNode(502, { error: 'node-unreachable' });
    }

    if (!nodeResponse.ok) {
      let detail = '';
      try {
        const text = await nodeResponse.text();
        detail = text.slice(0, 500);
      } catch {
        detail = '';
      }
      return failNode(502, {
        error: 'node-error',
        details: detail ? [detail] : undefined,
      });
    }

    const nodeBody = (await nodeResponse.json()) as {
      response: Envelope<InferenceResponse>;
      metering: Envelope<MeteringRecord>;
    };

    const responseValidation = validateEnvelope(nodeBody.response, validateInferenceResponse);
    if (!responseValidation.ok) {
      return failNode(
        502,
        { error: 'invalid-node-response', details: responseValidation.errors },
        'node-response-invalid',
      );
    }

    const meteringValidation = validateEnvelope(nodeBody.metering, validateMeteringRecord);
    if (!meteringValidation.ok) {
      return failNode(
        502,
        { error: 'invalid-metering', details: meteringValidation.errors },
        'metering-invalid',
      );
    }

    if (
      nodeBody.response.payload.requestId !== expectedRequestId ||
      nodeBody.metering.payload.requestId !== expectedRequestId
    ) {
      return failNode(502, { error: 'node-response-mismatch' }, 'response-mismatch');
    }

    const responseKeyId = nodeBody.response.keyId;
    const meteringKeyId = nodeBody.metering.keyId;
    if (responseKeyId !== meteringKeyId) {
      return failNode(502, { error: 'node-response-key-mismatch' }, 'response-key-mismatch');
    }

    let resolvedNode: NodeDescriptor | undefined;
    if (allowDelegation) {
      resolvedNode =
        responseKeyId === targetNode.keyId
          ? targetNode
          : service.nodes.find((entry) => entry.keyId === responseKeyId);
      if (!resolvedNode) {
        return failNode(502, { error: 'node-response-unknown' }, 'response-unknown');
      }
    } else if (responseKeyId !== targetNode.keyId) {
      return failNode(502, { error: 'node-response-signature-invalid' }, 'response-signature');
    } else {
      resolvedNode = targetNode;
    }

    const responseKey = parsePublicKey(responseKeyId);
    if (!verifyEnvelope(nodeBody.response, responseKey)) {
      return failNode(502, { error: 'node-response-signature-invalid' }, 'response-signature');
    }
    if (!verifyEnvelope(nodeBody.metering, responseKey)) {
      return failNode(502, { error: 'node-metering-signature-invalid' }, 'metering-signature');
    }
    recordNodeSuccess(service, resolvedNode.nodeId);
    if (resolvedNode.nodeId !== targetNode.nodeId) {
      logWarn('[router] node delegated response', {
        target: targetNode.nodeId,
        worker: resolvedNode.nodeId,
      });
    }

    return { ok: true, body: { response: nodeBody.response, metering: nodeBody.metering } };
  };

  const iterateResponseBody = async function* (body: unknown): AsyncIterable<Uint8Array> {
    if (!body) {
      return;
    }
    const isAsyncIterable = (value: unknown): value is AsyncIterable<Uint8Array> =>
      Boolean(value && typeof (value as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === 'function');
    const hasGetReader = (
      value: unknown,
    ): value is { getReader: () => { read: () => Promise<{ done: boolean; value?: Uint8Array }> } } =>
      Boolean(value && typeof (value as { getReader?: unknown }).getReader === 'function');
    if (isAsyncIterable(body)) {
      for await (const chunk of body as AsyncIterable<Uint8Array>) {
        yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      }
      return;
    }
    if (hasGetReader(body)) {
      const reader = body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value) {
          yield Buffer.from(value);
        }
      }
    }
  };

  const streamNodeResponse = async ({
    nodeResponse,
    nodeKey,
    expectedRequestId,
    res,
  }: {
    nodeResponse: Response;
    nodeKey: Uint8Array;
    expectedRequestId: string;
    res: ServerResponse;
  }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of iterateResponseBody(nodeResponse.body)) {
      buffer += decoder.decode(chunk, { stream: true });
      let separatorIndex = buffer.indexOf('\n\n');
      while (separatorIndex !== -1) {
        const raw = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        separatorIndex = buffer.indexOf('\n\n');
        if (!raw.trim()) {
          continue;
        }
        let event = 'message';
        const dataLines: string[] = [];
        for (const line of raw.split('\n')) {
          if (line.startsWith('event:')) {
            event = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trim());
          }
        }
        const dataText = dataLines.join('\n');
        if (!dataText) {
          continue;
        }
        let data: unknown;
        try {
          data = JSON.parse(dataText);
        } catch {
          return { ok: false, error: 'stream-invalid-json' };
        }
        if (event === 'final') {
          const payload = data as { response: Envelope<InferenceResponse>; metering: Envelope<MeteringRecord> };
          const responseValidation = validateEnvelope(payload.response, validateInferenceResponse);
          if (!responseValidation.ok) {
            return { ok: false, error: 'invalid-node-response' };
          }
          const meteringValidation = validateEnvelope(payload.metering, validateMeteringRecord);
          if (!meteringValidation.ok) {
            return { ok: false, error: 'invalid-metering' };
          }
          if (
            payload.response.payload.requestId !== expectedRequestId ||
            payload.metering.payload.requestId !== expectedRequestId
          ) {
            return { ok: false, error: 'request-id-mismatch' };
          }
          if (!verifyEnvelope(payload.response, nodeKey) || !verifyEnvelope(payload.metering, nodeKey)) {
            return { ok: false, error: 'invalid-node-signature' };
          }
          sendSseEvent(res, 'final', payload);
          res.end();
          return { ok: true };
        }
        if (event === 'error') {
          sendSseEvent(res, 'error', data);
          res.end();
          return { ok: false, error: 'node-stream-error' };
        }
        if (event === 'chunk') {
          sendSseEvent(res, 'chunk', data);
        }
      }
    }
    return { ok: false, error: 'stream-ended' };
  };

  const adminHandler = createAdminHandler(service, config);

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
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

    const requestId = ensureRequestId(req, res);
    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && req.url === '/status') {
      const activeNodes = filterActiveNodes(service, service.nodes);
      return sendJson(res, 200, {
        ok: true,
        uptimeMs: Date.now() - startedAtMs,
        nodes: {
          total: service.nodes.length,
          active: activeNodes.length,
        },
        payments: {
          requests: service.paymentRequests.size,
          receipts: service.paymentReceipts.size,
        },
        federation: {
          enabled: config.federation?.enabled ?? false,
          paymentRequests: service.federationPaymentRequests.size,
          paymentReceipts: service.federationPaymentReceipts.size,
        },
        stake: {
          commits: service.stakeStore.commits.size,
          slashes: service.stakeStore.slashes.size,
        },
        state: {
          persistenceEnabled: Boolean(config.statePath),
        },
      });
    }

    if (req.method === 'GET' && req.url === '/metrics') {
      const metrics = await routerRegistry.metrics();
      res.setHeader('content-type', routerRegistry.contentType);
      res.end(metrics);
      return;
    }

    if (req.method === 'POST' && req.url === '/register-node') {
      try {
        const body = await readJsonBody(req, config.maxRequestBytes);
        if (!body.ok) {
          return sendJson(res, bodyErrorStatus(body.error), { error: body.error });
        }

        const validation = validateEnvelope(body.value, validateNodeDescriptor);
        if (!validation.ok) {
          return sendJson(res, 400, { error: 'invalid-envelope', details: validation.errors });
        }

        const envelope = body.value as Envelope<NodeDescriptor>;
        if (!isNostrNpub(envelope.keyId)) {
          return sendJson(res, 400, { error: 'invalid-key-id' });
        }
        const rateLimit = checkIngressRateLimit(envelope.keyId);
        if (!rateLimit.ok) {
          return sendJson(res, rateLimit.status, { error: rateLimit.error });
        }
        if (envelope.payload.keyId !== envelope.keyId) {
          return sendJson(res, 400, { error: 'key-id-mismatch' });
        }

        const endpointValidation = validateEndpoint(envelope.payload.endpoint, config.allowPrivateEndpoints);
        if (!endpointValidation.ok) {
          return sendJson(res, 400, { error: endpointValidation.error });
        }

        const replay = checkReplay(envelope, store);
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

        await registerNode(service, updated);

        return sendJson(res, 200, { ok: true });
      } catch (error) {
        return sendJson(res, 500, { error: 'internal-error' });
      }
    }

    if (req.method === 'POST' && req.url === '/manifest') {
      try {
        const body = await readJsonBody(req, config.maxRequestBytes);
        if (!body.ok) {
          return sendJson(res, bodyErrorStatus(body.error), { error: body.error });
        }

        const manifest = body.value as NodeManifest;
        if (!manifest.signature) {
          return sendJson(res, 400, { error: 'missing-signature' });
        }
        if (!isNostrNpub(manifest.signature.keyId)) {
          return sendJson(res, 400, { error: 'invalid-key-id' });
        }
        const rateLimit = checkIngressRateLimit(manifest.signature.keyId);
        if (!rateLimit.ok) {
          return sendJson(res, rateLimit.status, { error: rateLimit.error });
        }

        const publicKey = parsePublicKey(manifest.signature.keyId);
        if (!verifyManifest(manifest, publicKey)) {
          return sendJson(res, 401, { error: 'invalid-signature' });
        }

        const admissionPolicy = config.relayAdmission ?? defaultRelayAdmissionPolicy;
        const admission = assessRelayDiscoverySnapshot(manifest.relay_discovery, admissionPolicy);
        await recordManifestAdmission(service, manifest.id, admission);
        await recordManifest(service, manifest);
        return sendJson(res, 200, { ok: true });
      } catch (error) {
        return sendJson(res, 500, { error: 'internal-error' });
      }
    }

    if (req.method === 'POST' && req.url === '/federation/caps') {
      try {
        if (!config.federation?.enabled) {
          return sendJson(res, 503, { error: 'federation-disabled' });
        }
        const body = await readJsonBody(req, config.maxRequestBytes);
        if (!body.ok) {
          return sendJson(res, bodyErrorStatus(body.error), { error: body.error });
        }

        const validated = verifyFederationMessage<RouterCapabilityProfile>(
          body.value,
          validateRouterCapabilityProfile,
        );
        if (!validated.ok) {
          return sendJson(res, 400, { error: validated.error, details: validated.details });
        }

        const message = validated.message;
        const publicKey = parsePublicKey(message.routerId);
        if (!verifyRouterMessage(message, publicKey)) {
          return sendJson(res, 401, { error: 'invalid-signature' });
        }
        const restriction = getPeerRestriction(message.routerId);
        if (restriction) {
          return sendJson(res, 403, { error: `peer-${restriction}` });
        }

        service.federation.capabilities = message.payload;
        federationMessages.inc({ type: message.type });
        return sendJson(res, 200, { ok: true });
      } catch (error) {
        return sendJson(res, 500, { error: 'internal-error' });
      }
    }

    if (req.method === 'POST' && req.url === '/federation/self/caps') {
      try {
        if (!config.federation?.enabled) {
          return sendJson(res, 503, { error: 'federation-disabled' });
        }
        if (!config.privateKey) {
          return sendJson(res, 500, { error: 'router-private-key-missing' });
        }
        const body = await readJsonBody(req, config.maxRequestBytes);
        if (!body.ok) {
          return sendJson(res, bodyErrorStatus(body.error), { error: body.error });
        }

        const validation = validateRouterCapabilityProfile(body.value);
        if (!validation.ok) {
          return sendJson(res, 400, { error: 'invalid-capabilities', details: validation.errors });
        }

        const payload = body.value as RouterCapabilityProfile;
        if (payload.routerId !== config.keyId) {
          return sendJson(res, 400, { error: 'router-id-mismatch' });
        }

        service.federation.localCapabilities = payload;
        const message: RouterControlMessage<RouterCapabilityProfile> = {
          type: 'CAPS_ANNOUNCE',
          version: '0.1',
          routerId: config.keyId,
          messageId: `${payload.routerId}:${payload.timestamp}`,
          timestamp: Date.now(),
          expiry: payload.expiry,
          payload,
          sig: '',
        };
        const signed = signRouterMessage(message, config.privateKey);
        federationMessages.inc({ type: message.type });
        return sendJson(res, 200, { message: signed });
      } catch (error) {
        return sendJson(res, 500, { error: 'internal-error' });
      }
    }

    if (req.method === 'POST' && req.url === '/federation/price') {
      try {
        if (!config.federation?.enabled) {
          return sendJson(res, 503, { error: 'federation-disabled' });
        }
        const body = await readJsonBody(req, config.maxRequestBytes);
        if (!body.ok) {
          return sendJson(res, bodyErrorStatus(body.error), { error: body.error });
        }

        const validated = verifyFederationMessage<RouterPriceSheet>(
          body.value,
          validateRouterPriceSheet,
        );
        if (!validated.ok) {
          return sendJson(res, 400, { error: validated.error, details: validated.details });
        }

        const message = validated.message;
        const publicKey = parsePublicKey(message.routerId);
        if (!verifyRouterMessage(message, publicKey)) {
          return sendJson(res, 401, { error: 'invalid-signature' });
        }
        const restriction = getPeerRestriction(message.routerId);
        if (restriction) {
          return sendJson(res, 403, { error: `peer-${restriction}` });
        }

        service.federation.priceSheets.set(message.payload.jobType, message.payload);
        federationMessages.inc({ type: message.type });
        return sendJson(res, 200, { ok: true });
      } catch (error) {
        return sendJson(res, 500, { error: 'internal-error' });
      }
    }

    if (req.method === 'POST' && req.url === '/federation/self/price') {
      try {
        if (!config.federation?.enabled) {
          return sendJson(res, 503, { error: 'federation-disabled' });
        }
        if (!config.privateKey) {
          return sendJson(res, 500, { error: 'router-private-key-missing' });
        }
        const body = await readJsonBody(req, config.maxRequestBytes);
        if (!body.ok) {
          return sendJson(res, bodyErrorStatus(body.error), { error: body.error });
        }

        const validation = validateRouterPriceSheet(body.value);
        if (!validation.ok) {
          return sendJson(res, 400, { error: 'invalid-price-sheet', details: validation.errors });
        }

        const payload = body.value as RouterPriceSheet;
        if (payload.routerId !== config.keyId) {
          return sendJson(res, 400, { error: 'router-id-mismatch' });
        }

        service.federation.localPriceSheets.set(payload.jobType, payload);
        const message: RouterControlMessage<RouterPriceSheet> = {
          type: 'PRICE_ANNOUNCE',
          version: '0.1',
          routerId: config.keyId,
          messageId: `${payload.routerId}:${payload.jobType}`,
          timestamp: Date.now(),
          expiry: payload.expiry,
          payload,
          sig: '',
        };
        const signed = signRouterMessage(message, config.privateKey);
        federationMessages.inc({ type: message.type });
        return sendJson(res, 200, { message: signed });
      } catch (error) {
        return sendJson(res, 500, { error: 'internal-error' });
      }
    }

    if (req.method === 'POST' && req.url === '/federation/status') {
      try {
        if (!config.federation?.enabled) {
          return sendJson(res, 503, { error: 'federation-disabled' });
        }
        const body = await readJsonBody(req, config.maxRequestBytes);
        if (!body.ok) {
          return sendJson(res, bodyErrorStatus(body.error), { error: body.error });
        }

        const validated = verifyFederationMessage<RouterStatusPayload>(
          body.value,
          validateRouterStatusPayload,
        );
        if (!validated.ok) {
          return sendJson(res, 400, { error: validated.error, details: validated.details });
        }

        const message = validated.message;
        const publicKey = parsePublicKey(message.routerId);
        if (!verifyRouterMessage(message, publicKey)) {
          return sendJson(res, 401, { error: 'invalid-signature' });
        }
        const restriction = getPeerRestriction(message.routerId);
        if (restriction) {
          return sendJson(res, 403, { error: `peer-${restriction}` });
        }

        service.federation.status = message.payload;
        federationMessages.inc({ type: message.type });
        return sendJson(res, 200, { ok: true });
      } catch (error) {
        return sendJson(res, 500, { error: 'internal-error' });
      }
    }

    if (req.method === 'POST' && req.url === '/federation/self/status') {
      try {
        if (!config.federation?.enabled) {
          return sendJson(res, 503, { error: 'federation-disabled' });
        }
        if (!config.privateKey) {
          return sendJson(res, 500, { error: 'router-private-key-missing' });
        }
        const body = await readJsonBody(req, config.maxRequestBytes);
        if (!body.ok) {
          return sendJson(res, bodyErrorStatus(body.error), { error: body.error });
        }

        const validation = validateRouterStatusPayload(body.value);
        if (!validation.ok) {
          return sendJson(res, 400, { error: 'invalid-status', details: validation.errors });
        }

        const payload = body.value as RouterStatusPayload;
        if (payload.routerId !== config.keyId) {
          return sendJson(res, 400, { error: 'router-id-mismatch' });
        }

        service.federation.localStatus = payload;
        const message: RouterControlMessage<RouterStatusPayload> = {
          type: 'STATUS_ANNOUNCE',
          version: '0.1',
          routerId: config.keyId,
          messageId: `${payload.routerId}:${payload.timestamp}`,
          timestamp: Date.now(),
          expiry: payload.expiry,
          payload,
          sig: '',
        };
        const signed = signRouterMessage(message, config.privateKey);
        federationMessages.inc({ type: message.type });
        return sendJson(res, 200, { message: signed });
      } catch (error) {
        return sendJson(res, 500, { error: 'internal-error' });
      }
    }

    if (req.method === 'POST' && req.url === '/federation/rfb') {
      try {
        if (!config.federation?.enabled) {
          return sendJson(res, 503, { error: 'federation-disabled' });
        }
        const body = await readJsonBody(req, config.maxRequestBytes);
        if (!body.ok) {
          return sendJson(res, bodyErrorStatus(body.error), { error: body.error });
        }

        const validated = verifyFederationMessage<RouterRfbPayload>(
          body.value,
          validateRouterRfbPayload,
        );
        if (!validated.ok) {
          return sendJson(res, 400, { error: validated.error, details: validated.details });
        }

        const message = validated.message;
        const publicKey = parsePublicKey(message.routerId);
        if (!verifyRouterMessage(message, publicKey)) {
          return sendJson(res, 401, { error: 'invalid-signature' });
        }
        const restriction = getPeerRestriction(message.routerId);
        if (restriction) {
          return sendJson(res, 403, { error: `peer-${restriction}` });
        }
        if (federationRateLimiter && !federationRateLimiter.allow(message.routerId, message.type)) {
          return sendJson(res, 429, { error: 'rate-limited' });
        }

        federationMessages.inc({ type: message.type });
        const eligibility = canBidForRfb(service, config, message.payload);
        if (!eligibility.ok) {
          return sendJson(res, 204, { ok: false, reason: eligibility.reason });
        }
        const candidatePrice = estimateBidPrice(eligibility.priceSheet, message.payload.sizeEstimate);
        if (candidatePrice > message.payload.maxPriceMsat) {
          return sendJson(res, 204, { ok: false, reason: 'price-above-max' });
        }
        const bid: RouterControlMessage<RouterBidPayload> = {
          type: 'BID',
          version: '0.1',
          routerId: config.keyId,
          messageId: `${config.keyId}:${message.payload.jobId}:${Date.now()}`,
          timestamp: Date.now(),
          expiry: message.expiry,
          payload: {
            jobId: message.payload.jobId,
            priceMsat: candidatePrice,
            etaMs: 120,
            capacityToken: `${config.keyId}:${message.payload.jobId}`,
            bidHash: message.payload.jobHash,
          },
          sig: '',
        };
        if (!config.privateKey) {
          return sendJson(res, 500, { error: 'router-private-key-missing' });
        }
        const signedBid = signRouterMessage(bid, config.privateKey);
        return sendJson(res, 200, { bid: signedBid });
      } catch (error) {
        return sendJson(res, 500, { error: 'internal-error' });
      }
    }

    if (req.method === 'POST' && req.url === '/federation/bid') {
      try {
        if (!config.federation?.enabled) {
          return sendJson(res, 503, { error: 'federation-disabled' });
        }
        const body = await readJsonBody(req, config.maxRequestBytes);
        if (!body.ok) {
          return sendJson(res, bodyErrorStatus(body.error), { error: body.error });
        }

        const validated = verifyFederationMessage<RouterBidPayload>(
          body.value,
          validateRouterBidPayload,
        );
        if (!validated.ok) {
          return sendJson(res, 400, { error: validated.error, details: validated.details });
        }

        const message = validated.message;
        const publicKey = parsePublicKey(message.routerId);
        if (!verifyRouterMessage(message, publicKey)) {
          return sendJson(res, 401, { error: 'invalid-signature' });
        }
        const restriction = getPeerRestriction(message.routerId);
        if (restriction) {
          return sendJson(res, 403, { error: `peer-${restriction}` });
        }
        if (federationRateLimiter && !federationRateLimiter.allow(message.routerId, message.type)) {
          return sendJson(res, 429, { error: 'rate-limited' });
        }

        service.federation.bids.set(message.payload.jobId, message.payload);
        federationMessages.inc({ type: message.type });
        return sendJson(res, 200, { ok: true });
      } catch (error) {
        return sendJson(res, 500, { error: 'internal-error' });
      }
    }

    if (req.method === 'POST' && req.url === '/federation/award') {
      try {
        if (!config.federation?.enabled) {
          return sendJson(res, 503, { error: 'federation-disabled' });
        }
        const body = await readJsonBody(req, config.maxRequestBytes);
        if (!body.ok) {
          return sendJson(res, bodyErrorStatus(body.error), { error: body.error });
        }

        const validated = verifyFederationMessage<RouterAwardPayload>(
          body.value,
          validateRouterAwardPayload,
        );
        if (!validated.ok) {
          return sendJson(res, 400, { error: validated.error, details: validated.details });
        }

        const message = validated.message;
        const publicKey = parsePublicKey(message.routerId);
        if (!verifyRouterMessage(message, publicKey)) {
          return sendJson(res, 401, { error: 'invalid-signature' });
        }
        const restriction = getPeerRestriction(message.routerId);
        if (restriction) {
          return sendJson(res, 403, { error: `peer-${restriction}` });
        }
        if (federationRateLimiter && !federationRateLimiter.allow(message.routerId, message.type)) {
          return sendJson(res, 429, { error: 'rate-limited' });
        }

        if (message.payload.winnerRouterId !== config.keyId) {
          return sendJson(res, 403, { error: 'award-not-for-router' });
        }

        service.federation.awards.set(message.payload.jobId, message);
        federationMessages.inc({ type: message.type });
        return sendJson(res, 200, { ok: true, accepted: true });
      } catch (error) {
        return sendJson(res, 500, { error: 'internal-error' });
      }
    }

    if (req.method === 'POST' && req.url === '/federation/job-submit') {
      try {
        if (!config.federation?.enabled) {
          return sendJson(res, 503, { error: 'federation-disabled' });
        }
        const body = await readJsonBody(req, config.maxRequestBytes);
        if (!body.ok) {
          return sendJson(res, bodyErrorStatus(body.error), { error: body.error });
        }

        const parsed = parseSignedEnvelope<RouterJobSubmit>(
          body.value,
          validateRouterJobSubmit,
          store,
        );
        if (!parsed.ok) {
          return sendJson(res, 400, { error: parsed.error, details: parsed.details });
        }

        const envelope = parsed.envelope;
        const submit = envelope.payload;
        if (!allowsPrivacyLevel(config, submit.privacyLevel)) {
          return sendJson(res, 403, { error: 'privacy-level-not-allowed' });
        }

        const award = service.federation.awards.get(submit.jobId);
        if (!award) {
          return sendJson(res, 403, { error: 'missing-award' });
        }
        if (award.payload.winnerRouterId !== config.keyId) {
          return sendJson(res, 403, { error: 'award-not-for-router' });
        }
        if (award.payload.awardExpiry < Date.now()) {
          return sendJson(res, 403, { error: 'award-expired' });
        }
        if (submit.maxCostMsat < award.payload.acceptedPriceMsat) {
          return sendJson(res, 402, { error: 'max-cost-too-low' });
        }
        if (envelope.keyId !== award.routerId) {
          return sendJson(res, 403, { error: 'award-router-mismatch' });
        }

        service.federation.jobs.set(submit.jobId, {
          submit,
          requestRouterId: envelope.keyId,
          updatedAtMs: Date.now(),
          settlement: {},
        });
        federationJobs.inc({ stage: 'submit' });

        const decoded = parseInferencePayload(submit.payload);
        if (!decoded.ok) {
          return sendJson(res, 200, { ok: true, jobId: submit.jobId });
        }
        if (!config.privateKey) {
          return sendJson(res, 500, { error: 'router-private-key-missing' });
        }

        const candidates = rankCandidateNodes(
          filterActiveNodes(service, applyManifestWeights(service)),
          {
            requestId: decoded.request.requestId,
            modelId: decoded.request.modelId,
            maxTokens: decoded.request.maxTokens,
            inputTokensEstimate: estimateTokensFromText(decoded.request.prompt),
            outputTokensEstimate: decoded.request.maxTokens,
          },
          config.schedulerTopK,
        );

        let lastFailure: { status: number; body: { error: string; details?: string[] } } | null = null;
        for (const candidate of candidates) {
          const result = await attemptNodeInference({
            targetNode: candidate,
            payload: decoded.request,
            nonce: randomUUID(),
            expectedRequestId: decoded.request.requestId,
            allowDelegation: true,
          });
          if (!result.ok) {
            lastFailure = { status: result.status, body: result.body };
            continue;
          }
          const outputHash = hashString(result.body.response.payload.output);
          const priceSheet = service.federation.localPriceSheets.get(submit.jobType);
          const priceEstimate = priceSheet
            ? estimateBidPrice(priceSheet, {
                tokens:
                  (result.body.response.payload.usage.inputTokens ?? 0) +
                  (result.body.response.payload.usage.outputTokens ?? 0),
                bytes: submit.payload.length,
              })
            : submit.maxCostMsat;
          const receipt: RouterReceipt = signRouterReceipt(
            {
              jobId: submit.jobId,
              requestRouterId: envelope.keyId,
              workerRouterId: config.keyId,
              inputHash: submit.inputHash,
              outputHash,
              usage: {
                tokens:
                  (result.body.response.payload.usage.inputTokens ?? 0) +
                  (result.body.response.payload.usage.outputTokens ?? 0),
                runtimeMs: result.body.response.payload.latencyMs,
                bytesIn: submit.payload.length,
                bytesOut: result.body.response.payload.output.length,
              },
              priceMsat: Math.min(submit.maxCostMsat, priceEstimate),
              status: 'OK',
              startedAtMs: Date.now() - result.body.response.payload.latencyMs,
              finishedAtMs: Date.now(),
              receiptId: `${submit.jobId}:${randomUUID()}`,
              sig: '',
            },
            config.privateKey,
          );

          const jobResult: RouterJobResult = {
            jobId: submit.jobId,
            resultPayload: result.body.response.payload.output,
            outputHash,
            usage: receipt.usage,
            resultStatus: 'OK',
            receipt,
          };

          const record = service.federation.jobs.get(submit.jobId);
          if (record) {
            record.updatedAtMs = Date.now();
            record.result = jobResult;
          }

          federationJobs.inc({ stage: 'result' });
          return sendJson(res, 200, {
            ok: true,
            jobId: submit.jobId,
            response: result.body.response,
            metering: result.body.metering,
            receipt,
          });
        }

        if (lastFailure) {
          return sendJson(res, lastFailure.status, lastFailure.body);
        }
        return sendJson(res, 503, { error: 'no-nodes-available' });
      } catch (error) {
        return sendJson(res, 500, { error: 'internal-error' });
      }
    }

    if (req.method === 'POST' && req.url === '/federation/job-result') {
      try {
        if (!config.federation?.enabled) {
          return sendJson(res, 503, { error: 'federation-disabled' });
        }
        const body = await readJsonBody(req, config.maxRequestBytes);
        if (!body.ok) {
          return sendJson(res, bodyErrorStatus(body.error), { error: body.error });
        }

        const parsed = parseSignedEnvelope<RouterJobResult>(
          body.value,
          validateRouterJobResult,
          store,
        );
        if (!parsed.ok) {
          return sendJson(res, 400, { error: parsed.error, details: parsed.details });
        }
        const envelope = parsed.envelope;
        const result = envelope.payload;
        const receiptValidation = validateRouterReceipt(result.receipt);
        if (!receiptValidation.ok) {
          accountingFailures.inc({ reason: 'receipt-invalid' });
          return sendJson(res, 400, { error: 'invalid-receipt', details: receiptValidation.errors });
        }
        if (result.receipt.jobId !== result.jobId) {
          accountingFailures.inc({ reason: 'receipt-job-mismatch' });
          return sendJson(res, 400, { error: 'receipt-job-mismatch' });
        }

        const workerKey = parsePublicKey(result.receipt.workerRouterId);
        if (!verifyRouterReceipt(result.receipt, workerKey)) {
          accountingFailures.inc({ reason: 'receipt-signature' });
          return sendJson(res, 401, { error: 'invalid-receipt-signature' });
        }
        if (envelope.keyId !== result.receipt.workerRouterId) {
          accountingFailures.inc({ reason: 'receipt-worker-mismatch' });
          return sendJson(res, 400, { error: 'receipt-worker-mismatch' });
        }
        if (
          config.federation?.maxSpendMsat !== undefined &&
          result.receipt.priceMsat > config.federation.maxSpendMsat
        ) {
          accountingFailures.inc({ reason: 'federation-over-cap' });
          return sendJson(res, 402, { error: 'federation-over-cap' });
        }

        const existing = service.federation.outboundJobs.get(result.jobId);
        if (!existing) {
          return sendJson(res, 404, { error: 'unknown-job' });
        }
        if (result.receipt.requestRouterId !== config.keyId) {
          return sendJson(res, 403, { error: 'receipt-requester-mismatch' });
        }
        if (existing.submit.inputHash !== result.receipt.inputHash) {
          return sendJson(res, 400, { error: 'receipt-input-hash-mismatch' });
        }
        if (result.receipt.outputHash && result.outputHash !== result.receipt.outputHash) {
          return sendJson(res, 400, { error: 'receipt-output-hash-mismatch' });
        }
        if (existing.award.payload.winnerRouterId !== result.receipt.workerRouterId) {
          return sendJson(res, 403, { error: 'receipt-worker-not-awarded' });
        }
        existing.updatedAtMs = Date.now();
        existing.result = result;
        existing.settlement = { ...(existing.settlement ?? {}), receipt: result.receipt };
        federationJobs.inc({ stage: 'result' });
        return sendJson(res, 200, { ok: true, jobId: result.jobId });
      } catch (error) {
        return sendJson(res, 500, { error: 'internal-error' });
      }
    }

    if (req.method === 'POST' && req.url === '/federation/payment-request') {
      try {
        if (!config.federation?.enabled) {
          return sendJson(res, 503, { error: 'federation-disabled' });
        }
        if (!config.privateKey) {
          return sendJson(res, 500, { error: 'router-private-key-missing' });
        }
        const body = await readJsonBody(req, config.maxRequestBytes);
        if (!body.ok) {
          return sendJson(res, bodyErrorStatus(body.error), { error: body.error });
        }

        const validation = validateRouterReceipt(body.value);
        if (!validation.ok) {
          return sendJson(res, 400, { error: 'invalid-receipt', details: validation.errors });
        }

        const receipt = body.value as RouterReceipt;
        const workerKey = parsePublicKey(receipt.workerRouterId);
        if (!verifyRouterReceipt(receipt, workerKey)) {
          return sendJson(res, 401, { error: 'invalid-receipt-signature' });
        }
        if (receipt.requestRouterId !== config.keyId) {
          return sendJson(res, 403, { error: 'receipt-requester-mismatch' });
        }

        const job = service.federation.outboundJobs.get(receipt.jobId);
        if (!job) {
          return sendJson(res, 404, { error: 'unknown-job' });
        }
        if (job.submit.inputHash !== receipt.inputHash) {
          return sendJson(res, 400, { error: 'receipt-input-hash-mismatch' });
        }
        if (receipt.outputHash && job.result?.outputHash && receipt.outputHash !== job.result.outputHash) {
          return sendJson(res, 400, { error: 'receipt-output-hash-mismatch' });
        }
        if (job.award.payload.winnerRouterId !== receipt.workerRouterId) {
          return sendJson(res, 403, { error: 'receipt-worker-not-awarded' });
        }
        if (
          config.federation?.maxSpendMsat !== undefined &&
          receipt.priceMsat > config.federation.maxSpendMsat
        ) {
          return sendJson(res, 402, { error: 'federation-over-cap' });
        }

        const amountSats = Math.max(1, Math.ceil(receipt.priceMsat / 1000));
        const paymentRequest: PaymentRequest = {
          requestId: receipt.jobId,
          payeeType: 'router',
          payeeId: receipt.workerRouterId,
          amountSats,
          invoice: `lnbc-federation-${receipt.jobId}`,
          expiresAtMs: Date.now() + PAYMENT_WINDOW_MS,
          metadata: { federationJobId: receipt.jobId },
        };
        service.federationPaymentRequests.set(receipt.jobId, paymentRequest);

        const paymentEnvelope = signEnvelope(
          buildEnvelope(paymentRequest, receipt.jobId, Date.now(), config.keyId),
          config.privateKey,
        );
        job.updatedAtMs = Date.now();
        job.settlement = { ...(job.settlement ?? {}), paymentRequest };

        return sendJson(res, 200, { payment: paymentEnvelope });
      } catch (error) {
        return sendJson(res, 500, { error: 'internal-error' });
      }
    }

    if (req.method === 'POST' && req.url === '/federation/payment-receipt') {
      try {
        if (!config.federation?.enabled) {
          return sendJson(res, 503, { error: 'federation-disabled' });
        }
        const body = await readJsonBody(req, config.maxRequestBytes);
        if (!body.ok) {
          return sendJson(res, bodyErrorStatus(body.error), { error: body.error });
        }

        const validation = validateEnvelope(body.value, validatePaymentReceipt);
        if (!validation.ok) {
          return sendJson(res, 400, { error: 'invalid-envelope', details: validation.errors });
        }

        const envelope = body.value as Envelope<PaymentReceipt>;
        if (!isNostrNpub(envelope.keyId)) {
          return sendJson(res, 400, { error: 'invalid-key-id' });
        }
        const clientKey = parsePublicKey(envelope.keyId);
        if (!verifyEnvelope(envelope, clientKey)) {
          return sendJson(res, 401, { error: 'invalid-signature' });
        }

        const receipt = envelope.payload;
        if (receipt.payeeType !== 'router') {
          return sendJson(res, 400, { error: 'invalid-payee-type' });
        }

        const storedRequest = service.federationPaymentRequests.get(receipt.requestId);
        if (!storedRequest) {
          return sendJson(res, 404, { error: 'payment-request-not-found' });
        }
        if (storedRequest.amountSats !== receipt.amountSats) {
          return sendJson(res, 400, { error: 'payment-amount-mismatch' });
        }

        service.paymentReceipts.set(
          paymentKey(receipt.requestId, receipt.payeeType, receipt.payeeId),
          envelope,
        );
        service.federationPaymentReceipts.set(receipt.requestId, envelope);
        const existing = service.federation.outboundJobs.get(receipt.requestId);
        if (existing) {
          existing.updatedAtMs = Date.now();
          existing.settlement = { ...(existing.settlement ?? {}), paymentReceipt: envelope };
        }
        return sendJson(res, 200, { ok: true });
      } catch (error) {
        return sendJson(res, 500, { error: 'internal-error' });
      }
    }

    if (req.method === 'POST' && req.url === '/stake/commit') {
      try {
        const body = await readJsonBody(req, config.maxRequestBytes);
        if (!body.ok) {
          return sendJson(res, bodyErrorStatus(body.error), { error: body.error });
        }

        const validation = validateEnvelope(body.value, validateStakeCommit);
        if (!validation.ok) {
          return sendJson(res, 400, { error: 'invalid-envelope', details: validation.errors });
        }

        const envelope = body.value as Envelope<import('@fed-ai/protocol').StakeCommit>;
        if (!isNostrNpub(envelope.keyId)) {
          return sendJson(res, 400, { error: 'invalid-key-id' });
        }
        const rateLimit = checkIngressRateLimit(envelope.keyId);
        if (!rateLimit.ok) {
          return sendJson(res, rateLimit.status, { error: rateLimit.error });
        }
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
        const body = await readJsonBody(req, config.maxRequestBytes);
        if (!body.ok) {
          return sendJson(res, bodyErrorStatus(body.error), { error: body.error });
        }

        const validation = validateEnvelope(body.value, validateStakeSlash);
        if (!validation.ok) {
          return sendJson(res, 400, { error: 'invalid-envelope', details: validation.errors });
        }

        const envelope = body.value as Envelope<import('@fed-ai/protocol').StakeSlash>;
        if (!isNostrNpub(envelope.keyId)) {
          return sendJson(res, 400, { error: 'invalid-key-id' });
        }
        const rateLimit = checkIngressRateLimit(envelope.keyId);
        if (!rateLimit.ok) {
          return sendJson(res, rateLimit.status, { error: rateLimit.error });
        }
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
        const body = await readJsonBody(req, config.maxRequestBytes);
        if (!body.ok) {
          return sendJson(res, bodyErrorStatus(body.error), { error: body.error });
        }

        const validation = await validateSignedEnvelope<QuoteRequest>(
          body.value,
          'QuoteRequest',
          validateQuoteRequest,
          envelopeWorkerPool,
        );
        if (!validation.ok) {
          return sendJson(res, validation.status, {
            error: validation.error,
            details: validation.details,
          });
        }
        const envelope = validation.envelope;
        const access = checkClientAccess(config, envelope.keyId);
        if (!access.ok) {
          return sendJson(res, access.status, { error: access.error });
        }
        const rateLimit = checkIngressRateLimit(envelope.keyId);
        if (!rateLimit.ok) {
          return sendJson(res, rateLimit.status, { error: rateLimit.error });
        }
        const replay = checkReplay(envelope, store);
        if (!replay.ok) {
          return sendJson(res, 400, { error: replay.error });
        }

        if (!config.privateKey) {
          return sendJson(res, 500, { error: 'router-private-key-missing' });
        }

        const selection = selectNode({
          nodes: filterActiveNodes(service, getWeightedNodes(service)),
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
      const span = routerTracer.startSpan('router.paymentReceipt', {
        attributes: {
          component: 'router',
          'router.endpoint': config.endpoint,
          'request.id': requestId,
        },
      });
      let statusLabel = '200';
      const respond = (status: number, body: unknown): void => {
        statusLabel = status.toString();
        span.setAttribute('http.status_code', status);
        sendJson(res, status, body);
      };
      try {
        const body = await readJsonBody(req, config.maxRequestBytes);
        if (!body.ok) {
          paymentReceiptFailures.inc();
          return respond(bodyErrorStatus(body.error), { error: body.error });
        }

        const validation = validateEnvelope(body.value, validatePaymentReceipt);
        if (!validation.ok) {
          paymentReceiptFailures.inc();
          return respond(400, { error: 'invalid-envelope', details: validation.errors });
        }

        const envelope = body.value as Envelope<PaymentReceipt>;
        if (!isNostrNpub(envelope.keyId)) {
          paymentReceiptFailures.inc();
          return respond(400, { error: 'invalid-key-id' });
        }
        const access = checkClientAccess(config, envelope.keyId);
        if (!access.ok) {
          paymentReceiptFailures.inc();
          return respond(access.status, { error: access.error });
        }
        const rateLimit = checkIngressRateLimit(envelope.keyId);
        if (!rateLimit.ok) {
          paymentReceiptFailures.inc();
          return respond(rateLimit.status, { error: rateLimit.error });
        }
        const clientKey = parsePublicKey(envelope.keyId);
        if (!verifyEnvelope(envelope, clientKey)) {
          paymentReceiptFailures.inc();
          return respond(401, { error: 'invalid-signature' });
        }

        const payeeType = envelope.payload.payeeType;
        const payeeId = envelope.payload.payeeId;
        const key = paymentKey(envelope.payload.requestId, payeeType, payeeId);
        const expectedRequest = service.paymentRequests.get(key);

        if (!expectedRequest) {
          paymentReceiptFailures.inc();
          return respond(400, { error: 'payment-request-not-found' });
        }

        if (envelope.payload.amountSats !== expectedRequest.amountSats) {
          paymentReceiptFailures.inc();
          return respond(400, { error: 'payment-amount-mismatch' });
        }
        if (!splitsMatch(expectedRequest.splits, envelope.payload.splits)) {
          paymentReceiptFailures.inc();
          return respond(400, { error: 'payment-split-mismatch' });
        }
        if (envelope.payload.splits && envelope.payload.splits.length > 0) {
          const splitTotal = envelope.payload.splits.reduce((sum, split) => sum + split.amountSats, 0);
          if (splitTotal !== envelope.payload.amountSats) {
            paymentReceiptFailures.inc();
            return respond(400, { error: 'payment-split-total-mismatch' });
          }
        }

        if (
          expectedRequest.invoice &&
          envelope.payload.invoice &&
          expectedRequest.invoice !== envelope.payload.invoice
        ) {
          paymentReceiptFailures.inc();
          return respond(400, { error: 'invoice-mismatch' });
        }

        const verification = await verifyPaymentReceipt(
          envelope.payload,
          config.paymentVerification,
        );
        if (!verification.ok) {
          paymentReceiptFailures.inc();
          return respond(400, { error: verification.error });
        }

        await recordPaymentReceipt(service, key, envelope);
        return respond(200, { ok: true });
      } catch (error) {
        return respond(500, { error: 'internal-error' });
      } finally {
        paymentRequests.inc();
        span.end();
      }
    }

    if (req.method === 'POST' && req.url === '/node/offload') {
      const span = routerTracer.startSpan('router.nodeOffload', {
        attributes: {
          component: 'router',
          'router.endpoint': config.endpoint,
          'request.id': requestId,
        },
      });
      const respond = (status: number, body: unknown): void => {
        sendJson(res, status, body);
      };
      try {
        const body = await readJsonBody(req, config.maxRequestBytes);
        if (!body.ok) {
          return respond(bodyErrorStatus(body.error), { error: body.error });
        }

        const validation = validateEnvelope(body.value, validateNodeOffloadRequest);
        if (!validation.ok) {
          return respond(400, { error: 'invalid-envelope', details: validation.errors });
        }

        const envelope = body.value as Envelope<NodeOffloadRequest>;
        if (!isNostrNpub(envelope.keyId)) {
          return respond(400, { error: 'invalid-key-id' });
        }
        const rateLimit = checkIngressRateLimit(envelope.keyId);
        if (!rateLimit.ok) {
          return respond(rateLimit.status, { error: rateLimit.error });
        }
        const nodeRecord = service.nodes.find(
          (node) => node.nodeId === envelope.payload.originNodeId,
        );
        if (!nodeRecord || nodeRecord.keyId !== envelope.keyId) {
          return respond(403, { error: 'node-not-registered' });
        }
        const nodeKey = parsePublicKey(envelope.keyId);
        if (!verifyEnvelope(envelope, nodeKey)) {
          return respond(401, { error: 'invalid-signature' });
        }
        const replay = checkReplay(envelope, store);
        if (!replay.ok) {
          return respond(400, { error: replay.error });
        }
        if (!config.privateKey) {
          return respond(500, { error: 'router-private-key-missing' });
        }

        const requestEstimate: QuoteRequest = {
          requestId: envelope.payload.request.requestId,
          modelId: envelope.payload.request.modelId,
          maxTokens: envelope.payload.request.maxTokens,
          inputTokensEstimate: estimateTokensFromText(envelope.payload.request.prompt),
          outputTokensEstimate: envelope.payload.request.maxTokens,
          jobType: envelope.payload.request.jobType,
        };

        const avoidNodes = new Set<string>([
          envelope.payload.originNodeId,
          ...(envelope.payload.avoidNodeIds ?? []),
        ]);
        const candidates = filterActiveNodes(service, getWeightedNodes(service)).filter(
          (node) => !avoidNodes.has(node.nodeId),
        );

        const ranked = rankCandidateNodes(candidates, requestEstimate, config.schedulerTopK);
        for (const candidate of ranked) {
          const capability = pickCapabilityForRequest(candidate, requestEstimate);
          if (!capability) {
            continue;
          }
          const candidatePayload: InferenceRequest = {
            ...envelope.payload.request,
            modelId: capability.modelId,
          };
          const result = await attemptNodeInference({
            targetNode: candidate,
            payload: candidatePayload,
            nonce: envelope.nonce,
            expectedRequestId: envelope.payload.request.requestId,
            allowDelegation: true,
          });
          if (result.ok) {
            return respond(200, result.body);
          }
        }

        const offloadEnvelope = signEnvelope(
          buildEnvelope(envelope.payload.request, randomUUID(), Date.now(), config.keyId),
          config.privateKey,
        );
        const offload = await attemptFederationOffload(offloadEnvelope);
        if (offload.ok) {
          return respond(200, offload.body);
        }

        return respond(503, { error: 'no-nodes-available' });
      } catch (error) {
        return respond(500, { error: 'internal-error' });
      } finally {
        span.end();
      }
    }

    if (req.method === 'POST' && req.url === '/infer/stream') {
      const span = routerTracer.startSpan('router.inferStream', {
        attributes: {
          component: 'router',
          'router.endpoint': config.endpoint,
          'request.id': requestId,
        },
      });
      const timer = inferenceDuration.startTimer();
      let statusLabel = '200';
      let streaming = false;
      const respond = (status: number, body: unknown): void => {
        statusLabel = status.toString();
        span.setAttribute('http.status_code', status);
        sendJson(res, status, body);
      };
      const sendStreamError = (error: string, details?: unknown): void => {
        if (!res.writableEnded) {
          sendSseEvent(res, 'error', { error, details });
          res.end();
        }
      };
      try {
        const body = await readJsonBody(req, config.maxRequestBytes);
        if (!body.ok) {
          return respond(bodyErrorStatus(body.error), { error: body.error });
        }

        const validation = await validateSignedEnvelope<InferenceRequest>(
          body.value,
          'InferenceRequest',
          validateInferenceRequest,
          envelopeWorkerPool,
        );
        if (!validation.ok) {
          return respond(validation.status, {
            error: validation.error,
            details: validation.details,
          });
        }
        const envelope = validation.envelope;
        const access = checkClientAccess(config, envelope.keyId);
        if (!access.ok) {
          return respond(access.status, { error: access.error });
        }
        const rateLimit = checkIngressRateLimit(envelope.keyId);
        if (!rateLimit.ok) {
          return respond(rateLimit.status, { error: rateLimit.error });
        }
        const replay = checkReplay(envelope, store);
        if (!replay.ok) {
          return respond(400, { error: replay.error });
        }

        if (!config.privateKey) {
          return respond(500, { error: 'router-private-key-missing' });
        }

        const requestEstimate: QuoteRequest = {
          requestId: envelope.payload.requestId,
          modelId: envelope.payload.modelId,
          maxTokens: envelope.payload.maxTokens,
          inputTokensEstimate: estimateTokensFromText(envelope.payload.prompt),
          outputTokensEstimate: envelope.payload.maxTokens,
          jobType: envelope.payload.jobType,
        };

        const candidates = rankCandidateNodes(
          filterActiveNodes(service, getWeightedNodes(service)),
          requestEstimate,
          config.schedulerTopK,
        );

        const attemptStream = async (
          node: NodeDescriptor,
          payload: InferenceRequest,
        ): Promise<{ ok: true } | { ok: false; status: number; body: { error: string; details?: string[] } }> => {
          if (!config.privateKey) {
            return { ok: false, status: 500, body: { error: 'router-private-key-missing' } };
          }
          const forwardEnvelope = signEnvelope(
            buildEnvelope(payload, envelope.nonce, Date.now(), config.keyId),
            config.privateKey,
          );

          let nodeResponse: Response;
          try {
            nodeResponse = await fetch(`${node.endpoint}/infer/stream`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(forwardEnvelope),
            });
          } catch (error) {
            markNodeFailure(service, node.nodeId);
            return { ok: false, status: 502, body: { error: 'node-unreachable' } };
          }

          if (!nodeResponse.ok) {
            let detail = '';
            try {
              const text = await nodeResponse.text();
              detail = text.slice(0, 500);
            } catch {
              detail = '';
            }
            markNodeFailure(service, node.nodeId);
            return {
              ok: false,
              status: 502,
              body: { error: 'node-error', details: detail ? [detail] : undefined },
            };
          }

          const contentType = nodeResponse.headers.get('content-type') ?? '';
          if (!contentType.includes('text/event-stream')) {
            markNodeFailure(service, node.nodeId);
            return { ok: false, status: 502, body: { error: 'node-stream-unavailable' } };
          }

          startSse(res);
          streaming = true;
          const nodeKey = parsePublicKey(node.keyId);
          const streamResult = await streamNodeResponse({
            nodeResponse,
            nodeKey,
            expectedRequestId: envelope.payload.requestId,
            res,
          });
          if (!streamResult.ok) {
            markNodeFailure(service, node.nodeId);
            sendStreamError(streamResult.error);
            return { ok: false, status: 502, body: { error: streamResult.error } };
          }
          return { ok: true };
        };

        if (config.requirePayment) {
          const node = candidates.find((candidate) => pickCapabilityForRequest(candidate, requestEstimate));
          if (!node) {
            const offload = await attemptFederationOffload(envelope);
            if (offload.ok) {
              startSse(res);
              streaming = true;
              sendSseEvent(res, 'final', offload.body);
              res.end();
              return;
            }
            return respond(503, { error: 'no-nodes-available' });
          }
          const selectedCapability = pickCapabilityForRequest(node, requestEstimate);
          if (!selectedCapability) {
            return respond(503, { error: 'no-capable-nodes' });
          }
          const promptTokensEstimate = requestEstimate.inputTokensEstimate;
          const resolvedRequest: InferenceRequest = {
            ...envelope.payload,
            modelId: selectedCapability.modelId,
          };

          const payeeType: PayeeType = 'node';
          const payeeId = node.nodeId;
          const paymentRequestKey = paymentKey(envelope.payload.requestId, payeeType, payeeId);
          const storedReceipt = service.paymentReceipts.get(paymentRequestKey);

          if (!storedReceipt) {
            if (!config.paymentInvoice) {
              return respond(503, { error: 'invoice-provider-required' });
            }
            const nodeTotal =
              selectedCapability.pricing.inputRate * promptTokensEstimate +
              selectedCapability.pricing.outputRate * envelope.payload.maxTokens;
            const nodeAmountSats = Math.max(1, Math.round(nodeTotal));
            const routerFeeSats = computeRouterFeeSats(nodeAmountSats, config);
            const totalAmountSats = nodeAmountSats + routerFeeSats;
            const splits: PaymentSplit[] | undefined =
              routerFeeSats > 0
                ? [
                    {
                      payeeType: 'node',
                      payeeId,
                      amountSats: nodeAmountSats,
                      role: 'node-inference',
                    },
                    {
                      payeeType: 'router',
                      payeeId: config.keyId,
                      amountSats: routerFeeSats,
                      role: 'router-fee',
                    },
                  ]
                : undefined;

            const now = Date.now();
            const invoiceResult = await requestInvoice(
              {
                requestId: envelope.payload.requestId,
                payeeId,
                amountSats: totalAmountSats,
                splits,
              },
              config.paymentInvoice,
            );
            if (!invoiceResult.ok) {
              return respond(502, { error: invoiceResult.error });
            }
            const invoice = invoiceResult.invoice.invoice;
            const paymentHash = invoiceResult.invoice.paymentHash;
            const expiresAtMs = invoiceResult.invoice.expiresAtMs ?? now + PAYMENT_WINDOW_MS;
            const existingRequest = service.paymentRequests.get(paymentRequestKey);
            const paymentRequest: PaymentRequest =
              existingRequest && existingRequest.expiresAtMs > now
                ? existingRequest
                : {
                    requestId: envelope.payload.requestId,
                    payeeType,
                    payeeId,
                    amountSats: totalAmountSats,
                    invoice,
                    expiresAtMs,
                    paymentHash,
                    splits,
                    metadata: {
                      currency: selectedCapability.pricing.currency,
                      nodeAmountSats: nodeAmountSats.toString(),
                      routerFeeSats: routerFeeSats.toString(),
                    },
                  };

            await recordPaymentRequest(service, paymentRequestKey, paymentRequest);
            paymentRequests.inc();

            const paymentEnvelope = signEnvelope(
              buildEnvelope(paymentRequest, envelope.nonce, Date.now(), config.keyId),
              config.privateKey,
            );

            return respond(402, { error: 'payment-required', payment: paymentEnvelope });
          }

          const requestPayload = { ...resolvedRequest, paymentReceipts: [storedReceipt] };
          const attempt = await attemptStream(node, requestPayload);
          if (!attempt.ok && !streaming) {
            respond(attempt.status, attempt.body);
            return;
          }
          return;
        }

        for (const candidate of candidates) {
          const capability = pickCapabilityForRequest(candidate, requestEstimate);
          if (!capability) {
            continue;
          }
          const candidatePayload: InferenceRequest = {
            ...envelope.payload,
            modelId: capability.modelId,
          };
          const result = await attemptStream(candidate, candidatePayload);
          if (result.ok) {
            return;
          }
        }

        const offload = await attemptFederationOffload(envelope);
        if (offload.ok) {
          startSse(res);
          streaming = true;
          sendSseEvent(res, 'final', offload.body);
          res.end();
          return;
        }

        return respond(503, { error: 'no-nodes-available' });
      } catch (error) {
        if (streaming) {
          sendStreamError('internal-error');
          return;
        }
        return respond(500, { error: 'internal-error' });
      } finally {
        timer();
        inferenceRequests.labels(statusLabel).inc();
        span.end();
      }
    }

    if (req.method === 'POST' && req.url === '/infer') {
      const span = routerTracer.startSpan('router.infer', {
        attributes: {
          component: 'router',
          'router.endpoint': config.endpoint,
          'request.id': requestId,
        },
      });
      const timer = inferenceDuration.startTimer();
      let statusLabel = '200';
      const respond = (status: number, body: unknown): void => {
        statusLabel = status.toString();
        span.setAttribute('http.status_code', status);
        sendJson(res, status, body);
      };
      try {
        const body = await readJsonBody(req, config.maxRequestBytes);
        if (!body.ok) {
          return respond(bodyErrorStatus(body.error), { error: body.error });
        }

        const validation = await validateSignedEnvelope<InferenceRequest>(
          body.value,
          'InferenceRequest',
          validateInferenceRequest,
          envelopeWorkerPool,
        );
        if (!validation.ok) {
          return respond(validation.status, {
            error: validation.error,
            details: validation.details,
          });
        }
        const envelope = validation.envelope;
        const access = checkClientAccess(config, envelope.keyId);
        if (!access.ok) {
          return respond(access.status, { error: access.error });
        }
        const rateLimit = checkIngressRateLimit(envelope.keyId);
        if (!rateLimit.ok) {
          return respond(rateLimit.status, { error: rateLimit.error });
        }
        const replay = checkReplay(envelope, store);
        if (!replay.ok) {
          return respond(400, { error: replay.error });
        }

        if (!config.privateKey) {
          return respond(500, { error: 'router-private-key-missing' });
        }

        const requestEstimate: QuoteRequest = {
          requestId: envelope.payload.requestId,
          modelId: envelope.payload.modelId,
          maxTokens: envelope.payload.maxTokens,
          inputTokensEstimate: estimateTokensFromText(envelope.payload.prompt),
          outputTokensEstimate: envelope.payload.maxTokens,
          jobType: envelope.payload.jobType,
        };

        const selection = selectNode({
          nodes: filterActiveNodes(service, getWeightedNodes(service)),
          request: requestEstimate,
        });

        const node = selection.selected;

        if (!node) {
          const offload = await attemptFederationOffload(envelope);
          if (offload.ok) {
            respond(200, offload.body);
            return;
          }
          return respond(503, { error: selection.reason ?? offload.error ?? 'no-nodes-available' });
        }

        const selectedCapability = pickCapabilityForRequest(node, requestEstimate);
        if (!selectedCapability) {
          return respond(503, { error: 'no-capable-nodes' });
        }
        const resolvedRequest: InferenceRequest = {
          ...envelope.payload,
          modelId: selectedCapability.modelId,
        };

        if (config.requirePayment) {
          const payeeType: PayeeType = 'node';
          const payeeId = node.nodeId;
          const paymentRequestKey = paymentKey(envelope.payload.requestId, payeeType, payeeId);
          const storedReceipt = service.paymentReceipts.get(paymentRequestKey);

          if (!storedReceipt) {
            if (!config.paymentInvoice) {
              return respond(503, { error: 'invoice-provider-required' });
            }
            const nodeTotal =
              selectedCapability.pricing.inputRate * requestEstimate.inputTokensEstimate +
              selectedCapability.pricing.outputRate * envelope.payload.maxTokens;
            const nodeAmountSats = Math.max(1, Math.round(nodeTotal));
            const routerFeeSats = computeRouterFeeSats(nodeAmountSats, config);
            const totalAmountSats = nodeAmountSats + routerFeeSats;
            const splits: PaymentSplit[] | undefined =
              routerFeeSats > 0
                ? [
                    {
                      payeeType: 'node',
                      payeeId,
                      amountSats: nodeAmountSats,
                      role: 'node-inference',
                    },
                    {
                      payeeType: 'router',
                      payeeId: config.keyId,
                      amountSats: routerFeeSats,
                      role: 'router-fee',
                    },
                  ]
                : undefined;

            const now = Date.now();
            const invoiceResult = await requestInvoice(
              {
                requestId: envelope.payload.requestId,
                payeeId,
                amountSats: totalAmountSats,
                splits,
              },
              config.paymentInvoice,
            );
            if (!invoiceResult.ok) {
              return respond(502, { error: invoiceResult.error });
            }
            const invoice = invoiceResult.invoice.invoice;
            const paymentHash = invoiceResult.invoice.paymentHash;
            const expiresAtMs = invoiceResult.invoice.expiresAtMs ?? now + PAYMENT_WINDOW_MS;
            const existingRequest = service.paymentRequests.get(paymentRequestKey);
            const paymentRequest: PaymentRequest =
              existingRequest && existingRequest.expiresAtMs > now
                ? existingRequest
                : {
                    requestId: envelope.payload.requestId,
                    payeeType,
                    payeeId,
                    amountSats: totalAmountSats,
                    invoice,
                    expiresAtMs,
                    paymentHash,
                    splits,
                    metadata: {
                      currency: selectedCapability.pricing.currency,
                      nodeAmountSats: nodeAmountSats.toString(),
                      routerFeeSats: routerFeeSats.toString(),
                    },
                  };

            await recordPaymentRequest(service, paymentRequestKey, paymentRequest);
            paymentRequests.inc();

            const paymentEnvelope = signEnvelope(
              buildEnvelope(paymentRequest, envelope.nonce, Date.now(), config.keyId),
              config.privateKey,
            );

            return respond(402, { error: 'payment-required', payment: paymentEnvelope });
          }

          const requestPayload = { ...resolvedRequest, paymentReceipts: [storedReceipt] };
          const attempt = await attemptNodeInference({
            targetNode: node,
            payload: requestPayload,
            nonce: envelope.nonce,
            expectedRequestId: envelope.payload.requestId,
            allowDelegation: false,
          });
          if (!attempt.ok) {
            respond(attempt.status, attempt.body);
            return;
          }
          respond(200, attempt.body);
          return;
        }

        const candidates = rankCandidateNodes(
          filterActiveNodes(service, getWeightedNodes(service)),
          requestEstimate,
          config.schedulerTopK,
        );

        let lastFailure: { status: number; body: { error: string; details?: string[] } } | null =
          null;
        for (const candidate of candidates) {
          const capability = pickCapabilityForRequest(candidate, requestEstimate);
          if (!capability) {
            continue;
          }
          const candidatePayload: InferenceRequest = {
            ...envelope.payload,
            modelId: capability.modelId,
          };
          const result = await attemptNodeInference({
            targetNode: candidate,
            payload: candidatePayload,
            nonce: envelope.nonce,
            expectedRequestId: envelope.payload.requestId,
            allowDelegation: false,
          });
          if (result.ok) {
            respond(200, result.body);
            return;
          }
          lastFailure = { status: result.status, body: result.body };
        }

        if (lastFailure) {
          respond(lastFailure.status, lastFailure.body);
          return;
        }

        respond(503, { error: 'no-nodes-available' });
        return;
      } catch (error) {
        return respond(500, { error: 'internal-error' });
      } finally {
        timer();
        inferenceRequests.labels(statusLabel).inc();
        span.end();
      }
    }

    if (req.method === 'GET' && req.url === '/nodes') {
      return sendJson(res, 200, { nodes: service.nodes, active: filterActiveNodes(service, service.nodes) });
    }

    return sendJson(res, 404, { error: 'not-found' });
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
