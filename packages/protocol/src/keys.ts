import { createPrivateKey, createPublicKey, KeyObject } from 'node:crypto';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

const isHexKey = (value: string): boolean => {
  return /^[0-9a-fA-F]{64}$/.test(value);
};

const publicKeyFromHex = (hex: string): KeyObject => {
  const raw = Buffer.from(hex, 'hex');
  // Wrap raw Ed25519 key bytes into SPKI for Node crypto.
  const spki = Buffer.concat([ED25519_SPKI_PREFIX, raw]);
  return createPublicKey({ key: spki, format: 'der', type: 'spki' });
};

const privateKeyFromHex = (hex: string): KeyObject => {
  const raw = Buffer.from(hex, 'hex');
  // Wrap raw Ed25519 key bytes into PKCS8 for Node crypto.
  const pkcs8 = Buffer.concat([ED25519_PKCS8_PREFIX, raw]);
  return createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
};

export const parsePublicKey = (value: string): KeyObject => {
  if (isHexKey(value)) {
    return publicKeyFromHex(value);
  }
  return createPublicKey(value);
};

export const parsePrivateKey = (value: string): KeyObject => {
  if (isHexKey(value)) {
    return privateKeyFromHex(value);
  }
  return createPrivateKey(value);
};
