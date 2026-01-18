import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  exportPrivateKeyHex,
  exportPrivateKeyNsec,
  exportPublicKeyHex,
  exportPublicKeyNpub,
  parsePrivateKey,
  parsePublicKey,
} from '../src/keys';

test('parsePublicKey accepts npub and hex keys', () => {
  const { publicKey } = generateKeyPairSync('ed25519');
  const hex = exportPublicKeyHex(publicKey);
  const npub = exportPublicKeyNpub(publicKey);

  const fromHex = parsePublicKey(hex);
  const fromNpub = parsePublicKey(npub);

  assert.equal(exportPublicKeyHex(fromHex), hex);
  assert.equal(exportPublicKeyHex(fromNpub), hex);
});

test('parsePrivateKey accepts nsec and hex keys', () => {
  const { privateKey } = generateKeyPairSync('ed25519');
  const hex = exportPrivateKeyHex(privateKey);
  const nsec = exportPrivateKeyNsec(privateKey);

  const fromHex = parsePrivateKey(hex);
  const fromNsec = parsePrivateKey(nsec);

  assert.equal(exportPrivateKeyHex(fromHex), hex);
  assert.equal(exportPrivateKeyHex(fromNsec), hex);
});
