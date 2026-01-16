import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profileSystem } from '../src/index';

test('profileSystem returns capability bands', async () => {
  const report = await profileSystem();
  assert.ok(report.capabilityBands.cpu);
  assert.ok(report.capabilityBands.ram);
  assert.ok(report.capabilityBands.disk);
  assert.ok(report.capabilityBands.net);
  assert.ok(report.capabilityBands.gpu);
});
