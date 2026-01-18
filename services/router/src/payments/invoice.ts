import type { PaymentInvoiceConfig } from '../config';
import type { PaymentSplit } from '@fed-ai/protocol';
import { withRetry } from './retry';

type InvoiceRequest = {
  requestId: string;
  payeeId: string;
  amountSats: number;
  splits?: PaymentSplit[];
};

type InvoiceResponse = {
  invoice: string;
  paymentHash?: string;
  expiresAtMs?: number;
};

export const requestInvoice = async (
  input: InvoiceRequest,
  config?: PaymentInvoiceConfig,
): Promise<{ ok: true; invoice: InvoiceResponse } | { ok: false; error: string }> => {
  if (!config) {
    return { ok: false, error: 'invoice-provider-not-configured' };
  }
  const idempotencyHeader = config.idempotencyHeader ?? 'Idempotency-Key';
  const idempotencyKey = `${input.requestId}:${input.payeeId}:${input.amountSats}`;

  try {
    const invoice = await withRetry(async () => {
      const controller = config.timeoutMs ? new AbortController() : null;
      const timeout = config.timeoutMs
        ? setTimeout(() => controller?.abort(), config.timeoutMs)
        : null;

      try {
        const response = await fetch(config.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [idempotencyHeader]: idempotencyKey,
          },
          body: JSON.stringify(input),
          signal: controller?.signal,
        });
        if (!response.ok) {
          throw new Error('invoice-provider-failed');
        }
        const payload = (await response.json()) as InvoiceResponse;
        if (!payload.invoice) {
          throw new Error('invoice-missing');
        }
        return payload;
      } finally {
        if (timeout) {
          clearTimeout(timeout);
        }
      }
    }, config);
    return { ok: true, invoice };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'invoice-provider-error' };
  }
};
