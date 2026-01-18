import {
  buildEnvelope,
  exportPublicKeyHex,
  parsePrivateKey,
  signEnvelope,
  parsePublicKey,
  derivePublicKeyHex,
  validateEnvelope,
  validateInferenceResponse,
  validateMeteringRecord,
  validatePaymentRequest,
  validateQuoteResponse,
  verifyEnvelope,
} from '@fed-ai/protocol';
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

export type FedAiClientConfig = {
  routerUrl: string;
  keyId: string;
  privateKey: string;
  fetchImpl?: typeof fetch;
  routerPublicKey?: string;
  verifyResponses?: boolean;
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
  }

  private signPayload<T>(payload: T): Envelope<T> {
    const envelope = buildEnvelope(payload, generateRequestId(), Date.now(), this.keyId);
    return signEnvelope(envelope, this.privateKey);
  }

  private async post<T>(path: string, envelope: Envelope<unknown>): Promise<Response> {
    return this.fetchImpl(`${this.routerUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    });
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

  public async quote(request: QuoteRequest): Promise<Envelope<QuoteResponse>> {
    const envelope = this.signPayload(request);
    const response = await this.post('/quote', envelope);
    if (!response.ok) {
      throw new Error(`quote failed: ${response.status}`);
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
      const detail = await response.text().catch(() => '');
      const suffix = detail ? ` ${detail}` : '';
      throw new Error(`infer failed: ${response.status}${suffix}`);
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
      const detail = await response.text().catch(() => '');
      const suffix = detail ? ` ${detail}` : '';
      throw new Error(`payment receipt failed: ${response.status}${suffix}`);
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
