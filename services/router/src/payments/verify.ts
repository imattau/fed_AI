import type { PaymentReceipt } from '@fed-ai/protocol';
import type { PaymentVerificationConfig } from '../config';
import { withRetry } from './retry';

type VerifyResponse = {
  paid: boolean;
  settledAtMs?: number;
  detail?: string;
};

const buildPayload = (receipt: PaymentReceipt) => ({
  invoice: receipt.invoice,
  paymentHash: receipt.paymentHash,
  preimage: receipt.preimage,
  amountSats: receipt.amountSats,
  payeeId: receipt.payeeId,
  requestId: receipt.requestId,
});

export const verifyPaymentReceipt = async (
  receipt: PaymentReceipt,
  config?: PaymentVerificationConfig,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  if (!config) {
    return { ok: true };
  }

  if (config.requirePreimage && !receipt.preimage) {
    return { ok: false, error: 'preimage-required' };
  }

  if (!receipt.invoice && !receipt.paymentHash && !receipt.preimage) {
    return { ok: false, error: 'payment-proof-missing' };
  }

  try {
    const payload = await withRetry(async () => {
      const controller = config.timeoutMs ? new AbortController() : null;
      const timeout = config.timeoutMs
        ? setTimeout(() => controller?.abort(), config.timeoutMs)
        : null;

      try {
        const response = await fetch(config.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(buildPayload(receipt)),
          signal: controller?.signal,
        });
        if (!response.ok) {
          throw new Error('payment-verify-failed');
        }
        return (await response.json()) as VerifyResponse;
      } finally {
        if (timeout) {
          clearTimeout(timeout);
        }
      }
    }, config);
    if (!payload.paid) {
      return { ok: false, error: payload.detail ?? 'payment-unsettled' };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'payment-verify-error' };
  }
};
