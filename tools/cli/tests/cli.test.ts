import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairHex, parseArgs } from '../src/lib';

test('parseArgs handles flags with values and booleans', () => {
  const args = parseArgs(['--router', 'http://localhost:8080', '--flag', '--model', 'mock']);
  assert.equal(args.router, 'http://localhost:8080');
  assert.equal(args.flag, 'true');
  assert.equal(args.model, 'mock');
});

test('generateKeyPairHex returns 32-byte hex keys', () => {
  const keys = generateKeyPairHex();
  assert.match(keys.publicKey, /^[0-9a-f]{64}$/);
  assert.match(keys.privateKey, /^[0-9a-f]{64}$/);
});
