import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  buildEnvelope,
  checkReplay,
  DEFAULT_REPLAY_WINDOW_MS,
  InMemoryNonceStore,
  signEnvelope,
  validateEnvelope,
  validateInferenceRequest,
  validatePaymentReceipt,
  validatePaymentRequest,
  validateProtocolError,
  verifyEnvelope,
} from '../src/index';
import type { InferenceRequest } from '../src/types';

test('signEnvelope and verifyEnvelope round-trip', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const payload: InferenceRequest = {
    requestId: 'req-1',
    modelId: 'mock-model',
    prompt: 'hello',
    maxTokens: 16,
  };

  const envelope = buildEnvelope(payload, 'nonce-1', Date.now(), 'key-1');
  const signed = signEnvelope(envelope, privateKey);

  assert.equal(verifyEnvelope(signed, publicKey), true);

  const { publicKey: otherPublicKey } = generateKeyPairSync('ed25519');
  assert.equal(verifyEnvelope(signed, otherPublicKey), false);
});

test('checkReplay enforces nonce and timestamp window', () => {
  const store = new InMemoryNonceStore();
  const now = Date.now();
  const payload = { ok: true };
  const envelope = buildEnvelope(payload, 'nonce-2', now, 'key-2');

  const first = checkReplay(envelope, store, { nowMs: now });
  assert.equal(first.ok, true);

  const second = checkReplay(envelope, store, { nowMs: now });
  assert.equal(second.ok, false);
  assert.equal(second.error, 'nonce-reused');

  const lateEnvelope = buildEnvelope(payload, 'nonce-3', now - DEFAULT_REPLAY_WINDOW_MS - 1, 'key-2');
  const lateResult = checkReplay(lateEnvelope, store, { nowMs: now });
  assert.equal(lateResult.ok, false);
  assert.equal(lateResult.error, 'ts-out-of-window');
});

test('validateEnvelope validates payloads', () => {
  const payload: InferenceRequest = {
    requestId: 'req-2',
    modelId: 'mock-model',
    prompt: 'hello',
    maxTokens: 8,
  };
  const envelope = buildEnvelope(payload, 'nonce-4', Date.now(), 'key-3');
  const result = validateEnvelope(envelope, validateInferenceRequest);
  assert.equal(result.ok, true);

  const invalidEnvelope = buildEnvelope({ bad: true }, 'nonce-5', Date.now(), 'key-3');
  const invalidResult = validateEnvelope(invalidEnvelope, validateInferenceRequest);
  assert.equal(invalidResult.ok, false);
});

test('validatePaymentRequest and validatePaymentReceipt enforce shape', () => {
  const request = {
    requestId: 'req-pay',
    nodeId: 'node-1',
    amountSats: 1000,
    invoice: 'lnbc1...',
    expiresAtMs: Date.now() + 60_000,
  };
  const receipt = {
    requestId: 'req-pay',
    nodeId: 'node-1',
    amountSats: 1000,
    paidAtMs: Date.now(),
  };

  assert.equal(validatePaymentRequest(request).ok, true);
  assert.equal(validatePaymentReceipt(receipt).ok, true);

  assert.equal(validatePaymentRequest({}).ok, false);
  assert.equal(validatePaymentReceipt({}).ok, false);
});

test('validateProtocolError checks error shape', () => {
  const error = {
    code: 'invalid-envelope',
    message: 'Envelope failed validation',
    retryable: false,
  };
  assert.equal(validateProtocolError(error).ok, true);
  assert.equal(validateProtocolError({ message: 'missing code' }).ok, false);
});
