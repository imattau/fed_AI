import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { exportPublicKeyNpub } from '@fed-ai/protocol';
import { scoreNode, selectNode } from '../src/scheduler';
import type { NodeDescriptor, QuoteRequest } from '@fed-ai/protocol';

const request: QuoteRequest = {
  requestId: 'req-1',
  modelId: 'mock-model',
  maxTokens: 32,
  inputTokensEstimate: 10,
  outputTokensEstimate: 20,
};

const makeNode = (nodeId: string, inputRate: number, outputRate: number, currentLoad: number): NodeDescriptor => {
  const { publicKey } = generateKeyPairSync('ed25519');
  return {
    nodeId,
    keyId: exportPublicKeyNpub(publicKey),
    endpoint: 'http://localhost:0',
    capacity: { maxConcurrent: 10, currentLoad },
    capabilities: [
      {
        modelId: 'mock-model',
        contextWindow: 4096,
        maxTokens: 1024,
        pricing: { unit: 'token', inputRate, outputRate, currency: 'USD' },
      },
    ],
  };
};

test('scoreNode prefers lower price and lower load', () => {
  const cheap = makeNode('cheap', 0.01, 0.01, 2);
  const expensive = makeNode('expensive', 0.05, 0.05, 1);

  const cheapScore = scoreNode(cheap, request);
  const expensiveScore = scoreNode(expensive, request);

  assert.ok(cheapScore !== null && expensiveScore !== null);
  assert.ok(cheapScore > expensiveScore);
});

test('selectNode chooses best scored node', () => {
  const lowLoad = makeNode('low-load', 0.02, 0.02, 1);
  const highLoad = makeNode('high-load', 0.01, 0.01, 9);

  const selection = selectNode({ nodes: [lowLoad, highLoad], request });
  assert.equal(selection.selected?.nodeId, 'low-load');
});
