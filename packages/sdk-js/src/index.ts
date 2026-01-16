import { randomUUID } from 'node:crypto';
import {
  buildEnvelope,
  parsePrivateKey,
  signEnvelope,
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
};

export class FedAiClient {
  private readonly routerUrl: string;
  private readonly keyId: string;
  private readonly privateKey: ReturnType<typeof parsePrivateKey>;
  private readonly fetchImpl: typeof fetch;

  constructor(config: FedAiClientConfig) {
    this.routerUrl = config.routerUrl.replace(/\/$/, '');
    this.keyId = config.keyId;
    this.privateKey = parsePrivateKey(config.privateKey);
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private signPayload<T>(payload: T): Envelope<T> {
    const envelope = buildEnvelope(payload, randomUUID(), Date.now(), this.keyId);
    return signEnvelope(envelope, this.privateKey);
  }

  private async post<T>(path: string, envelope: Envelope<unknown>): Promise<Response> {
    return this.fetchImpl(`${this.routerUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    });
  }

  public async quote(request: QuoteRequest): Promise<Envelope<QuoteResponse>> {
    const envelope = this.signPayload(request);
    const response = await this.post('/quote', envelope);
    if (!response.ok) {
      throw new Error(`quote failed: ${response.status}`);
    }
    const body = await response.json();
    return body.quote as Envelope<QuoteResponse>;
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
        throw new PaymentRequiredError(body.payment as Envelope<PaymentRequest>);
      }
      throw new Error(`infer failed: ${response.status}`);
    }
    const body = await response.json();
    return {
      response: body.response as Envelope<InferenceResponse>,
      metering: body.metering as Envelope<MeteringRecord>,
    };
  }

  public async sendPaymentReceipt(receipt: Envelope<PaymentReceipt>): Promise<void> {
    const response = await this.post('/payment-receipt', receipt);
    if (!response.ok) {
      throw new Error(`payment receipt failed: ${response.status}`);
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
    };
    return this.signPayload(payload);
  }
}
