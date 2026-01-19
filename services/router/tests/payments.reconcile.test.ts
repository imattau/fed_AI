import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcilePayments } from '../src/payments/reconcile';
import { paymentReconciliationFailures } from '../src/observability';
import type { RouterService } from '../src/server';
import type { RouterConfig } from '../src/config';

const getCounterValue = async (scope: 'client' | 'federation') => {
  const metric = await paymentReconciliationFailures.get();
  const entry = metric.values.find(
    (value) => value.labels?.scope === scope && value.labels?.reason === 'missing-receipt',
  );
  return entry?.value ?? 0;
};

test('reconcilePayments increments counter and logs missing receipts', async () => {
  paymentReconciliationFailures.reset();
  const now = Date.now();
  const service = {
    paymentRequests: new Map([['key-1', { expiresAtMs: now - 10_000 }]]),
    paymentReceipts: new Map(),
    federationPaymentRequests: new Map([['fed-1', { expiresAtMs: now - 10_000 }]]),
    federationPaymentReceipts: new Map(),
  } as unknown as RouterService;
  const config = { paymentReconcileGraceMs: 0 } as RouterConfig;

  const warnings: unknown[] = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args);
  };

  try {
    reconcilePayments(service, config);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(await getCounterValue('client'), 1);
  assert.equal(await getCounterValue('federation'), 1);
  assert.equal(warnings.length, 2);
});

test('reconcilePayments ignores receipts within grace or already received', async () => {
  paymentReconciliationFailures.reset();
  const now = Date.now();
  const service = {
    paymentRequests: new Map([['key-1', { expiresAtMs: now + 10_000 }]]),
    paymentReceipts: new Map([['key-2', { ok: true }]]),
    federationPaymentRequests: new Map([['fed-1', { expiresAtMs: now - 10_000 }]]),
    federationPaymentReceipts: new Map([['fed-1', { ok: true }]]),
  } as unknown as RouterService;
  const config = { paymentReconcileGraceMs: 20_000 } as RouterConfig;

  const warnings: unknown[] = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args);
  };

  try {
    reconcilePayments(service, config);
  } finally {
    console.warn = originalWarn;
  }

  const metric = await paymentReconciliationFailures.get();
  const total = metric.values.reduce((sum, entry) => sum + entry.value, 0);
  assert.equal(total, 0);
  assert.equal(warnings.length, 0);
});
