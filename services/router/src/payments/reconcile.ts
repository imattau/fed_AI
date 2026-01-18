import type { RouterService } from '../server';
import type { RouterConfig } from '../config';
import { paymentReconciliationFailures } from '../observability';
import { logWarn } from '../logging';

const reconcileMap = (
  scope: 'client' | 'federation',
  requests: Map<string, { expiresAtMs: number }>,
  receipts: Map<string, unknown>,
  nowMs: number,
  graceMs: number,
): void => {
  let missingReceipts = 0;
  for (const [key, request] of requests) {
    if (request.expiresAtMs + graceMs < nowMs && !receipts.has(key)) {
      missingReceipts += 1;
    }
  }
  if (missingReceipts > 0) {
    paymentReconciliationFailures.inc({ scope, reason: 'missing-receipt' }, missingReceipts);
    logWarn('[router] payment reconciliation detected missing receipts', {
      scope,
      count: missingReceipts,
    });
  }
};

export const reconcilePayments = (service: RouterService, config: RouterConfig): void => {
  const graceMs = Math.max(0, config.paymentReconcileGraceMs ?? 0);
  const nowMs = Date.now();
  reconcileMap('client', service.paymentRequests, service.paymentReceipts, nowMs, graceMs);
  reconcileMap('federation', service.federationPaymentRequests, service.federationPaymentReceipts, nowMs, graceMs);
};
