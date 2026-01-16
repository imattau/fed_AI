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
  validateStakeCommit,
  validateStakeSlash,
  verifyEnvelope,
} from '../src/index';
import type { Envelope, InferenceRequest, PaymentReceipt } from '../src/types';

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

test('validateInferenceRequest accepts paymentReceipt envelope', () => {
  const receipt: Envelope<PaymentReceipt> = {
    payload: {
      requestId: 'req-pay',
      nodeId: 'node-1',
      amountSats: 100,
      paidAtMs: Date.now(),
    },
    nonce: 'nonce-pay',
    ts: Date.now(),
    keyId: 'client-key-1',
    sig: 'sig',
  };

  const payload: InferenceRequest = {
    requestId: 'req-3',
    modelId: 'mock-model',
    prompt: 'hello',
    maxTokens: 8,
    paymentReceipt: receipt,
  };

  const result = validateInferenceRequest(payload);
  assert.equal(result.ok, true);
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

test('validateStakeCommit and validateStakeSlash enforce shape', () => {
  const commit = {
    stakeId: 'stake-1',
    actorId: 'node-1',
    actorType: 'node',
    units: 100,
    committedAtMs: Date.now(),
    expiresAtMs: Date.now() + 1000,
  };
  const slash = {
    slashId: 'slash-1',
    stakeId: 'stake-1',
    actorId: 'node-1',
    units: 10,
    reason: 'policy-violation',
    ts: Date.now(),
  };
  assert.equal(validateStakeCommit(commit).ok, true);
  assert.equal(validateStakeSlash(slash).ok, true);
  assert.equal(validateStakeCommit({}).ok, false);
  assert.equal(validateStakeSlash({}).ok, false);
});
