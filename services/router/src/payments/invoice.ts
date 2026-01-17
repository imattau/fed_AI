import type { PaymentInvoiceConfig } from '../config';

type InvoiceRequest = {
  requestId: string;
  payeeId: string;
  amountSats: number;
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

  const controller = config.timeoutMs ? new AbortController() : null;
  const timeout = config.timeoutMs
    ? setTimeout(() => controller?.abort(), config.timeoutMs)
    : null;

  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: controller?.signal,
    });
    if (!response.ok) {
      return { ok: false, error: 'invoice-provider-failed' };
    }
    const payload = (await response.json()) as InvoiceResponse;
    if (!payload.invoice) {
      return { ok: false, error: 'invoice-missing' };
    }
    return { ok: true, invoice: payload };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'invoice-provider-error' };
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};
