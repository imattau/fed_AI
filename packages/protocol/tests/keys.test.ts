import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import {
  exportPrivateKeyHex,
  exportPrivateKeyNsec,
  exportPublicKeyHex,
  exportPublicKeyNpub,
  parsePrivateKey,
  parsePublicKey,
} from '../src/keys';

test('parsePublicKey accepts npub and hex keys', () => {
  const secret = generateSecretKey();
  const publicKey = getPublicKey(secret);
  const publicKeyBytes = Buffer.from(publicKey, 'hex');
  const hex = exportPublicKeyHex(publicKeyBytes);
  const npub = exportPublicKeyNpub(publicKeyBytes);

  const fromHex = parsePublicKey(hex);
  const fromNpub = parsePublicKey(npub);

  assert.equal(exportPublicKeyHex(fromHex), hex);
  assert.equal(exportPublicKeyHex(fromNpub), hex);
});

test('parsePrivateKey accepts nsec and hex keys', () => {
  const privateKey = generateSecretKey();
  const hex = exportPrivateKeyHex(privateKey);
  const nsec = exportPrivateKeyNsec(privateKey);

  const fromHex = parsePrivateKey(hex);
  const fromNsec = parsePrivateKey(nsec);

  assert.equal(exportPrivateKeyHex(fromHex), hex);
  assert.equal(exportPrivateKeyHex(fromNsec), hex);
});
