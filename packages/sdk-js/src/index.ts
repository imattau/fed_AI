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
  Envelope,
  InferenceRequest,
  InferenceResponse,
  MeteringRecord,
  PaymentReceipt,
  PaymentRequest,
  QuoteRequest,
  QuoteResponse,
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

export type RetryOptions = {
  maxAttempts?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  statusCodes?: number[];
  methods?: Array<'GET' | 'POST'>;
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

  private async post(path: string, envelope: Envelope<unknown>): Promise<Response> {
    return this.requestWithRetry('POST', path, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    });
  }

  private async get(path: string): Promise<Response> {
    return this.requestWithRetry('GET', path);
  }

  private async requestWithRetry(method: 'GET' | 'POST', path: string, init?: RequestInit): Promise<Response> {
    const config = this.retry;
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
    validator: (input: unknown) => { ok: true; value: T } | { ok: false; errors: string[] },
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

  public async health(): Promise<{ ok: boolean }> {
    const response = await this.get('/health');
    if (!response.ok) {
      const detail = await this.readErrorDetail(response);
      throw new ApiError('/health', response.status, detail);
    }
    return response.json() as Promise<{ ok: boolean }>;
  }

  public async status(): Promise<Record<string, unknown>> {
    const response = await this.get('/status');
    if (!response.ok) {
      const detail = await this.readErrorDetail(response);
      throw new ApiError('/status', response.status, detail);
    }
    return response.json() as Promise<Record<string, unknown>>;
  }

  public async nodes(): Promise<{ nodes: unknown[]; active: unknown[] }> {
    const response = await this.get('/nodes');
    if (!response.ok) {
      const detail = await this.readErrorDetail(response);
      throw new ApiError('/nodes', response.status, detail);
    }
    return response.json() as Promise<{ nodes: unknown[]; active: unknown[] }>;
  }

  public async activeNodes(): Promise<unknown[]> {
    const payload = await this.nodes();
    return payload.active;
  }

  public async metrics(): Promise<string> {
    const response = await this.get('/metrics');
    if (!response.ok) {
      const detail = await this.readErrorDetail(response);
      throw new ApiError('/metrics', response.status, detail);
    }
    return response.text();
  }

  public async quote(request: QuoteRequest): Promise<Envelope<QuoteResponse>> {
    const envelope = this.signPayload(request);
    const response = await this.post('/quote', envelope);
    if (!response.ok) {
      const detail = await this.readErrorDetail(response);
      throw new ApiError('/quote', response.status, detail);
    }
    const body = await response.json();
    return this.parseEnvelope(body.quote, validateQuoteResponse, 'quote');
  }

  public async infer(request: InferenceRequest): Promise<{
    response: Envelope<InferenceResponse>;
    metering: Envelope<MeteringRecord>;
  }> {
    const payload: InferenceRequest = {
      ...request,
      paymentReceipts: request.paymentReceipts,
    };
    const envelope = this.signPayload(payload);
    const response = await this.post('/infer', envelope);
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

  public async sendPaymentReceipt(receipt: Envelope<PaymentReceipt>): Promise<void> {
    const response = await this.post('/payment-receipt', receipt);
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
    },
  ): Promise<{
    response: Envelope<InferenceResponse>;
    metering: Envelope<MeteringRecord>;
    payment?: { request: Envelope<PaymentRequest>; receipt: Envelope<PaymentReceipt> };
  }> {
    try {
      const result = await this.infer(request);
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
        await this.sendPaymentReceipt(receipt);
      }
      const retry = await this.infer({ ...request, paymentReceipts: [receipt] });
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
