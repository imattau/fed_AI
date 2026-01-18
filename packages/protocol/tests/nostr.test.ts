import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  buildRouterControlEvent,
  exportPrivateKeyHex,
  exportPublicKeyNpub,
  parseRouterControlEvent,
  ROUTER_NOSTR_KINDS,
} from '../src/index';
import type { RouterControlMessage, RouterCapabilityProfile } from '../src/types';

test('buildRouterControlEvent and parseRouterControlEvent round-trip', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const routerId = exportPublicKeyNpub(publicKey);
  const payload: RouterCapabilityProfile = {
    routerId,
    transportEndpoints: ['https://router.example'],
    supportedJobTypes: ['EMBEDDING'],
    resourceLimits: { maxPayloadBytes: 1024, maxTokens: 256, maxConcurrency: 2 },
    modelCaps: [{ modelId: 'mock', contextWindow: 2048, tools: [] }],
    privacyCaps: { maxLevel: 'PL1' },
    settlementCaps: { methods: ['lnurl'], currency: 'sats' },
    timestamp: Date.now(),
    expiry: Date.now() + 60_000,
  };

  const message: RouterControlMessage<RouterCapabilityProfile> = {
    type: 'CAPS_ANNOUNCE',
    version: '0.1',
    routerId,
    messageId: 'msg-1',
    timestamp: Date.now(),
    expiry: Date.now() + 60_000,
    payload,
    sig: 'unused',
  };

  const event = buildRouterControlEvent(message, exportPrivateKeyHex(privateKey));
  assert.equal(event.kind, ROUTER_NOSTR_KINDS.CAPS_ANNOUNCE);

  const parsed = parseRouterControlEvent<RouterCapabilityProfile>(event);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  assert.equal(parsed.message.routerId, routerId);
  assert.equal(parsed.message.type, 'CAPS_ANNOUNCE');
  assert.equal(parsed.message.messageId, 'msg-1');
  assert.equal(parsed.message.payload.routerId, routerId);
});
