import {
  buildEnvelope,
  derivePublicKeyHex,
  exportPublicKeyHex,
  exportPrivateKeyHex,
  exportPrivateKeyNsec,
  exportPublicKeyNpub,
  parsePrivateKey,
  signEnvelope,
  parsePublicKey,
  validateEnvelope,
  validateInferenceResponse,
  validateMeteringRecord,
  validatePaymentRequest,
  validateQuoteResponse,
  verifyEnvelope,
} from '@fed-ai/protocol';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import type {
  Capability,
  Envelope,
  InferenceRequest,
  InferenceResponse,
  MeteringRecord,
  ModelInfo,
  NodeDescriptor,
  PaymentReceipt,
  PaymentRequest,
  PaymentSplit,
  QuoteRequest,
  QuoteResponse,
  Validator,
} from '@fed-ai/protocol';

export class PaymentRequiredError extends Error {
  public paymentRequest: Envelope<PaymentRequest>;

  constructor(paymentRequest: Envelope<PaymentRequest>) {
    super('payment-required');
    this.paymentRequest = paymentRequest;
  }
}

export class ApiError extends Error {
  public status: number;
  public detail?: string;
  public path: string;

  constructor(path: string, status: number, detail?: string) {
    const suffix = detail ? ` ${detail}` : '';
    super(`${path} failed: ${status}${suffix}`);
    this.status = status;
    this.detail = detail;
    this.path = path;
  }
}

export type ApiErrorDetail = {
  error?: string;
  details?: unknown;
};

export type RetryOptions = {
  maxAttempts?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  statusCodes?: number[];
  methods?: Array<'GET' | 'POST'>;
};

export type RequestOptions = {
  retry?: RetryOptions;
};

export type FedAiClientConfig = {
  routerUrl: string;
  keyId: string;
  privateKey: string;
  fetchImpl?: typeof fetch;
  routerPublicKey?: string;
  verifyResponses?: boolean;
  retry?: RetryOptions;
};

export type KeyPair = {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  privateKeyHex: string;
  publicKeyHex: string;
  privateKeyNsec: string;
  publicKeyNpub: string;
};

export type NodeFilterOptions = {
  modelId?: string;
  regions?: string[];
  minTrustScore?: number;
};

export type PaymentReceiptMatch = {
  ok: boolean;
  reason?: string;
};

export const deriveKeyId = (privateKey: string, format: 'npub' | 'hex' = 'npub'): string => {
  const parsed = parsePrivateKey(privateKey);
  const publicKeyHex = derivePublicKeyHex(parsed);
  if (format === 'hex') {
    return publicKeyHex;
  }
  return exportPublicKeyNpub(Buffer.from(publicKeyHex, 'hex'));
};

export const generateKeyPair = (): KeyPair => {
  const privateKey = generateSecretKey();
  const publicKeyHex = getPublicKey(privateKey);
  const publicKey = Buffer.from(publicKeyHex, 'hex');
  return {
    privateKey,
    publicKey,
    privateKeyHex: exportPrivateKeyHex(privateKey),
    publicKeyHex,
    privateKeyNsec: exportPrivateKeyNsec(privateKey),
    publicKeyNpub: exportPublicKeyNpub(publicKey),
  };
};

export const parseErrorDetail = (detail?: string): ApiErrorDetail => {
  if (!detail) {
    return {};
  }
  try {
    const parsed = JSON.parse(detail) as Record<string, unknown>;
    if (typeof parsed.error === 'string') {
      return { error: parsed.error, details: parsed.details };
    }
    if (typeof parsed.error === 'object' && parsed.error !== null) {
      const nested = parsed.error as Record<string, unknown>;
      if (typeof nested.error === 'string' || typeof nested.message === 'string') {
        return { error: (nested.error ?? nested.message) as string, details: nested.detail ?? nested.details };
      }
    }
  } catch {
    // ignore parse errors
  }
  return { details: detail };
};

export const validateClientConfig = (config: FedAiClientConfig): { ok: true } | { ok: false; errors: string[] } => {
  const errors: string[] = [];
  if (!config.routerUrl) {
    errors.push('router-url-missing');
  } else {
    try {
      new URL(config.routerUrl);
    } catch {
      errors.push('router-url-invalid');
    }
  }
  if (!config.keyId) {
    errors.push('key-id-missing');
  }
  if (!config.privateKey) {
    errors.push('private-key-missing');
  }
  if (config.keyId && config.privateKey) {
    try {
      const derivedKeyHex = derivePublicKeyHex(parsePrivateKey(config.privateKey));
      const keyIdHex = exportPublicKeyHex(parsePublicKey(config.keyId));
      if (derivedKeyHex !== keyIdHex) {
        errors.push('key-id-mismatch');
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'key-validation-failed');
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
};

export const filterNodes = (nodes: NodeDescriptor[], options: NodeFilterOptions = {}): NodeDescriptor[] => {
  return nodes.filter((node) => {
    if (options.modelId) {
      const hasModel = node.capabilities.some((cap) => cap.modelId === options.modelId);
      if (!hasModel) {
        return false;
      }
    }
    if (options.regions && options.regions.length > 0) {
      if (!node.region || !options.regions.includes(node.region)) {
        return false;
      }
    }
    if (options.minTrustScore !== undefined) {
      if ((node.trustScore ?? 0) < options.minTrustScore) {
        return false;
      }
    }
    return true;
  });
};

export const sumSplits = (splits?: PaymentSplit[]): number => {
  if (!splits || splits.length === 0) {
    return 0;
  }
  return splits.reduce((sum, split) => sum + split.amountSats, 0);
};

export const routerFeeFromSplits = (splits?: PaymentSplit[]): number => {
  if (!splits || splits.length === 0) {
    return 0;
  }
  return splits
    .filter((split) => split.payeeType === 'router')
    .reduce((sum, split) => sum + split.amountSats, 0);
};

export const nodeAmountFromSplits = (splits?: PaymentSplit[]): number => {
  if (!splits || splits.length === 0) {
    return 0;
  }
  return splits
    .filter((split) => split.payeeType === 'node')
    .reduce((sum, split) => sum + split.amountSats, 0);
};

export const isPaymentExpired = (request: PaymentRequest, nowMs = Date.now()): boolean => {
  return request.expiresAtMs <= nowMs;
};

export const paymentReceiptMatchesRequest = (
  receipt: PaymentReceipt,
  request: PaymentRequest,
): PaymentReceiptMatch => {
  if (receipt.requestId !== request.requestId) {
    return { ok: false, reason: 'request-id-mismatch' };
  }
  if (receipt.payeeType !== request.payeeType || receipt.payeeId !== request.payeeId) {
    return { ok: false, reason: 'payee-mismatch' };
  }
  if (receipt.amountSats !== request.amountSats) {
    return { ok: false, reason: 'amount-mismatch' };
  }
  if (request.invoice && receipt.invoice && request.invoice !== receipt.invoice) {
    return { ok: false, reason: 'invoice-mismatch' };
  }
  if (request.splits || receipt.splits) {
    const requestTotal = sumSplits(request.splits);
    const receiptTotal = sumSplits(receipt.splits);
    if (requestTotal !== receiptTotal) {
      return { ok: false, reason: 'split-total-mismatch' };
    }
  }
  return { ok: true };
};

export const reconcilePaymentReceipts = (
  requests: PaymentRequest[],
  receipts: PaymentReceipt[],
  nowMs = Date.now(),
): { missing: PaymentRequest[]; expired: PaymentRequest[] } => {
  const receiptKeys = new Set(receipts.map((receipt) => `${receipt.requestId}:${receipt.payeeType}:${receipt.payeeId}`));
  const missing: PaymentRequest[] = [];
  const expired: PaymentRequest[] = [];
  for (const request of requests) {
    const key = `${request.requestId}:${request.payeeType}:${request.payeeId}`;
    if (!receiptKeys.has(key)) {
      missing.push(request);
      if (isPaymentExpired(request, nowMs)) {
        expired.push(request);
      }
    }
  }
  return { missing, expired };
};

export const pickCapability = (node: NodeDescriptor, modelId: string): Capability | undefined => {
  return node.capabilities.find((cap) => cap.modelId === modelId);
};

export const estimatePrice = (
  capability: Capability,
  request: Pick<QuoteRequest, 'inputTokensEstimate' | 'outputTokensEstimate'>,
): number | null => {
  if (capability.pricing.unit === 'token') {
    return (
      capability.pricing.inputRate * request.inputTokensEstimate +
      capability.pricing.outputRate * request.outputTokensEstimate
    );
  }
  if (capability.pricing.unit === 'second') {
    if (!capability.latencyEstimateMs) {
      return null;
    }
    const seconds = capability.latencyEstimateMs / 1000;
    return capability.pricing.inputRate * seconds;
  }
  return null;
};

export const filterNodesByPrice = (
  nodes: NodeDescriptor[],
  request: Pick<QuoteRequest, 'modelId' | 'inputTokensEstimate' | 'outputTokensEstimate'>,
  maxPrice: number,
): NodeDescriptor[] => {
  return nodes.filter((node) => {
    const capability = pickCapability(node, request.modelId);
    if (!capability) {
      return false;
    }
    const price = estimatePrice(capability, request);
    return price !== null && price <= maxPrice;
  });
};

export const listModels = (nodes: NodeDescriptor[]): ModelInfo[] => {
  const seen = new Map<string, ModelInfo>();
  for (const node of nodes) {
    for (const capability of node.capabilities) {
      if (!seen.has(capability.modelId)) {
        seen.set(capability.modelId, {
          id: capability.modelId,
          contextWindow: capability.contextWindow,
        });
      }
    }
  }
  return Array.from(seen.values());
};

export type RouterCandidate = { url: string; label?: string };

export const discoverRouter = async (
  candidates: Array<string | RouterCandidate>,
  options?: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    path?: string;
  },
): Promise<{ url: string }> => {
  const normalized = candidates.map((candidate) =>
    typeof candidate === 'string' ? { url: candidate } : candidate,
  );
  const fetchImpl = options?.fetchImpl ?? fetch;
  const path = options?.path ?? '/health';
  for (const candidate of normalized) {
    const controller = options?.timeoutMs ? new AbortController() : null;
    const timeout = options?.timeoutMs
      ? setTimeout(() => controller?.abort(), options.timeoutMs)
      : null;
    try {
      const response = await fetchImpl(`${candidate.url.replace(/\/$/, '')}${path}`, {
        signal: controller?.signal,
      });
      if (response.ok) {
        return { url: candidate.url.replace(/\/$/, '') };
      }
    } catch {
      // ignore and try next candidate
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
  throw new Error('no-healthy-router');
};

const generateRequestId = (): string => {
  const cryptoRef = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoRef && 'randomUUID' in cryptoRef) {
    return cryptoRef.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export class FedAiClient {
  private readonly routerUrl: string;
  private readonly keyId: string;
  private readonly privateKey: ReturnType<typeof parsePrivateKey>;
  private readonly routerPublicKey?: Uint8Array;
  private readonly verifyResponses: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly retry?: RetryOptions;

  constructor(config: FedAiClientConfig) {
    this.routerUrl = config.routerUrl.replace(/\/$/, '');
    this.keyId = config.keyId;
    this.privateKey = parsePrivateKey(config.privateKey);
    const derivedKeyHex = derivePublicKeyHex(this.privateKey);
    const keyIdHex = exportPublicKeyHex(parsePublicKey(this.keyId));
    if (keyIdHex !== derivedKeyHex) {
      throw new Error('key-id-mismatch');
    }
    this.routerPublicKey = config.routerPublicKey
      ? parsePublicKey(config.routerPublicKey)
      : undefined;
    this.verifyResponses = config.verifyResponses ?? Boolean(config.routerPublicKey);
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.retry = config.retry;
  }

  private signPayload<T>(payload: T): Envelope<T> {
    const envelope = buildEnvelope(payload, generateRequestId(), Date.now(), this.keyId);
    return signEnvelope(envelope, this.privateKey);
  }

  private async post(path: string, envelope: Envelope<unknown>, options?: RequestOptions): Promise<Response> {
    return this.requestWithRetry('POST', path, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    }, options);
  }

  private async get(path: string, options?: RequestOptions): Promise<Response> {
    return this.requestWithRetry('GET', path, undefined, options);
  }

  private async requestWithRetry(
    method: 'GET' | 'POST',
    path: string,
    init?: RequestInit,
    options?: RequestOptions,
  ): Promise<Response> {
    const config = options?.retry ?? this.retry;
    if (!config) {
      return this.fetchImpl(`${this.routerUrl}${path}`, { method, ...(init ?? {}) });
    }
    const maxAttempts = Math.max(1, config.maxAttempts ?? 1);
    const minDelayMs = Math.max(0, config.minDelayMs ?? 100);
    const maxDelayMs = Math.max(minDelayMs, config.maxDelayMs ?? 1000);
    const statusCodes = config.statusCodes ?? [408, 425, 429, 500, 502, 503, 504];
    const allowedMethods = config.methods ?? ['GET'];
    const shouldRetryMethod = allowedMethods.includes(method);

    const wait = (delayMs: number) =>
      new Promise((resolve) => {
        setTimeout(resolve, delayMs);
      });

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await this.fetchImpl(`${this.routerUrl}${path}`, { method, ...(init ?? {}) });
        if (!shouldRetryMethod || !statusCodes.includes(response.status) || attempt >= maxAttempts) {
          return response;
        }
      } catch (error) {
        if (!shouldRetryMethod || attempt >= maxAttempts) {
          throw error;
        }
      }
      const base = Math.min(maxDelayMs, minDelayMs * 2 ** Math.max(0, attempt - 1));
      const jitter = Math.floor(Math.random() * Math.min(50, minDelayMs));
      await wait(Math.min(maxDelayMs, base + jitter));
    }
    return this.fetchImpl(`${this.routerUrl}${path}`, { method, ...(init ?? {}) });
  }

  private async readErrorDetail(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      return '';
    }
  }

  private parseEnvelope<T>(
    value: unknown,
    validator: Validator<T>,
    label: string,
  ): Envelope<T> {
    const validation = validateEnvelope(value, validator);
    if (!validation.ok) {
      throw new Error(`${label}-invalid`);
    }
    const envelope = value as Envelope<T>;
    if (this.verifyResponses && this.routerPublicKey) {
      if (!verifyEnvelope(envelope, this.routerPublicKey)) {
        throw new Error(`${label}-signature`);
      }
    }
    return envelope;
  }

  public async health(options?: RequestOptions): Promise<{ ok: boolean }> {
    const response = await this.get('/health', options);
    if (!response.ok) {
      const detail = await this.readErrorDetail(response);
      throw new ApiError('/health', response.status, detail);
    }
    return response.json() as Promise<{ ok: boolean }>;
  }

  public async status(options?: RequestOptions): Promise<Record<string, unknown>> {
    const response = await this.get('/status', options);
    if (!response.ok) {
      const detail = await this.readErrorDetail(response);
      throw new ApiError('/status', response.status, detail);
    }
    return response.json() as Promise<Record<string, unknown>>;
  }

  public async nodes(options?: RequestOptions): Promise<{ nodes: NodeDescriptor[]; active: NodeDescriptor[] }> {
    const response = await this.get('/nodes', options);
    if (!response.ok) {
      const detail = await this.readErrorDetail(response);
      throw new ApiError('/nodes', response.status, detail);
    }
    return response.json() as Promise<{ nodes: NodeDescriptor[]; active: NodeDescriptor[] }>;
  }

  public async activeNodes(options?: RequestOptions): Promise<NodeDescriptor[]> {
    const payload = await this.nodes(options);
    return payload.active;
  }

  public async metrics(options?: RequestOptions): Promise<string> {
    const response = await this.get('/metrics', options);
    if (!response.ok) {
      const detail = await this.readErrorDetail(response);
      throw new ApiError('/metrics', response.status, detail);
    }
    return response.text();
  }

  public async quoteBatch(
    requests: QuoteRequest[],
  ): Promise<{
    quotes: Envelope<QuoteResponse>[];
    failures: Array<{ request: QuoteRequest; error: Error }>;
  }> {
    const results = await Promise.allSettled(requests.map((request) => this.quote(request)));
    const quotes: Envelope<QuoteResponse>[] = [];
    const failures: Array<{ request: QuoteRequest; error: Error }> = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        quotes.push(result.value);
      } else {
        failures.push({
          request: requests[index],
          error: result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
        });
      }
    });
    return { quotes, failures };
  }

  public async quote(request: QuoteRequest, options?: RequestOptions): Promise<Envelope<QuoteResponse>> {
    const envelope = this.signPayload(request);
    const response = await this.post('/quote', envelope, options);
    if (!response.ok) {
      const detail = await this.readErrorDetail(response);
      throw new ApiError('/quote', response.status, detail);
    }
    const body = await response.json();
    return this.parseEnvelope(body.quote, validateQuoteResponse, 'quote');
  }

  public async infer(request: InferenceRequest, options?: RequestOptions): Promise<{
    response: Envelope<InferenceResponse>;
    metering: Envelope<MeteringRecord>;
  }> {
    const payload: InferenceRequest = {
      ...request,
      paymentReceipts: request.paymentReceipts,
    };
    const envelope = this.signPayload(payload);
    const response = await this.post('/infer', envelope, options);
    if (!response.ok) {
      if (response.status === 402) {
        const body = await response.json();
        const payment = this.parseEnvelope(body.payment, validatePaymentRequest, 'payment');
        throw new PaymentRequiredError(payment);
      }
      const detail = await this.readErrorDetail(response);
      throw new ApiError('/infer', response.status, detail);
    }
    const body = await response.json();
    return {
      response: this.parseEnvelope(body.response, validateInferenceResponse, 'response'),
      metering: this.parseEnvelope(body.metering, validateMeteringRecord, 'metering'),
    };
  }

  public async sendPaymentReceipt(
    receipt: Envelope<PaymentReceipt>,
    options?: RequestOptions,
  ): Promise<void> {
    const response = await this.post('/payment-receipt', receipt, options);
    if (!response.ok) {
      const detail = await this.readErrorDetail(response);
      throw new ApiError('/payment-receipt', response.status, detail);
    }
  }

  public async inferWithPayment(
    request: InferenceRequest,
    options?: {
      onPaymentRequired?: (
        paymentRequest: Envelope<PaymentRequest>,
      ) => Promise<Envelope<PaymentReceipt>>;
      paymentReceiptOverrides?: {
        amountSats?: number;
        paidAtMs?: number;
        preimage?: string;
        invoice?: string;
        paymentHash?: string;
        splits?: PaymentRequest['splits'];
      };
      sendReceipt?: boolean;
      requestOptions?: RequestOptions;
    },
  ): Promise<{
    response: Envelope<InferenceResponse>;
    metering: Envelope<MeteringRecord>;
    payment?: { request: Envelope<PaymentRequest>; receipt: Envelope<PaymentReceipt> };
  }> {
    try {
      const result = await this.infer(request, options?.requestOptions);
      return { ...result };
    } catch (error) {
      if (!(error instanceof PaymentRequiredError)) {
        throw error;
      }
      const receipt = options?.onPaymentRequired
        ? await options.onPaymentRequired(error.paymentRequest)
        : this.createPaymentReceipt(error.paymentRequest, options?.paymentReceiptOverrides);
      const shouldSend = options?.sendReceipt ?? !options?.onPaymentRequired;
      if (shouldSend) {
        await this.sendPaymentReceipt(receipt, options?.requestOptions);
      }
      const retry = await this.infer({ ...request, paymentReceipts: [receipt] }, options?.requestOptions);
      return { ...retry, payment: { request: error.paymentRequest, receipt } };
    }
  }

  public createPaymentReceipt(
    request: Envelope<PaymentRequest>,
    overrides?: {
      amountSats?: number;
      paidAtMs?: number;
      preimage?: string;
      invoice?: string;
      paymentHash?: string;
      splits?: PaymentRequest['splits'];
    },
  ): Envelope<PaymentReceipt> {
    const payload: PaymentReceipt = {
      requestId: request.payload.requestId,
      payeeType: request.payload.payeeType,
      payeeId: request.payload.payeeId,
      amountSats: overrides?.amountSats ?? request.payload.amountSats,
      paidAtMs: overrides?.paidAtMs ?? Date.now(),
      paymentHash: overrides?.paymentHash,
      preimage: overrides?.preimage,
      invoice: overrides?.invoice ?? request.payload.invoice,
      splits: overrides?.splits ?? request.payload.splits,
    };
    return this.signPayload(payload);
  }
}

export { discoverRelays } from '@fed-ai/nostr-relay-discovery';
export type { DiscoveryOptions, RelayDescriptor } from '@fed-ai/nostr-relay-discovery';
