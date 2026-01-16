import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBench } from '../src/index';

test('runBench returns numeric scores', async () => {
  const result = await runBench({ mode: 'node' });
  assert.ok(result.cpuScore > 0);
  assert.ok(result.memoryMBps > 0);
  assert.ok(result.diskMBps > 0);
  assert.ok(result.timestampMs > 0);
});
