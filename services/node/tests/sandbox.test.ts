import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enforceSandboxPolicy } from '../src/sandbox/policy';
import type { NodeConfig } from '../src/config';

const baseConfig: NodeConfig = {
  nodeId: 'node-1',
  keyId: 'node-key',
  endpoint: 'http://localhost:0',
  routerEndpoint: 'http://localhost:8080',
  heartbeatIntervalMs: 10_000,
  runnerName: 'http',
  port: 0,
  capacityMaxConcurrent: 4,
  capacityCurrentLoad: 0,
  requirePayment: false,
};

test('sandbox policy requires allowlist and limits when restricted', () => {
  const result = enforceSandboxPolicy({
    ...baseConfig,
    sandboxMode: 'restricted',
    sandboxAllowedRunners: ['http'],
  });

  assert.equal(result.ok, false);
});

test('sandbox policy passes when restricted and limits set', () => {
  const result = enforceSandboxPolicy({
    ...baseConfig,
    sandboxMode: 'restricted',
    sandboxAllowedRunners: ['http'],
    maxPromptBytes: 1024,
    maxTokens: 256,
    maxRequestBytes: 2048,
  });

  assert.equal(result.ok, true);
});
