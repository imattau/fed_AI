import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withRetry } from '../src/payments/retry';

test('withRetry returns on first attempt', async () => {
  let attempts = 0;
  const result = await withRetry(async (attempt) => {
    attempts = attempt;
    return 'ok';
  }, { retryMaxAttempts: 3, retryMinDelayMs: 0, retryMaxDelayMs: 0 });

  assert.equal(result, 'ok');
  assert.equal(attempts, 1);
});

test('withRetry retries until success', async () => {
  let attempts = 0;
  const result = await withRetry(async (attempt) => {
    attempts = attempt;
    if (attempt < 2) {
      throw new Error('retry');
    }
    return 'ok';
  }, { retryMaxAttempts: 3, retryMinDelayMs: 0, retryMaxDelayMs: 0 });

  assert.equal(result, 'ok');
  assert.equal(attempts, 2);
});

test('withRetry throws after max attempts', async () => {
  let attempts = 0;
  await assert.rejects(
    () => withRetry(async (attempt) => {
      attempts = attempt;
      throw new Error(`fail-${attempt}`);
    }, { retryMaxAttempts: 2, retryMinDelayMs: 0, retryMaxDelayMs: 0 }),
    { message: 'fail-2' },
  );

  assert.equal(attempts, 2);
});
