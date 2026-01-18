import { createPrivateKey, createPublicKey, KeyObject } from 'node:crypto';
import { getPublicKey, nip19 } from 'nostr-tools';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

const isHexKey = (value: string): boolean => {
  return /^[0-9a-fA-F]{64}$/.test(value);
};

export const isNostrNpub = (value: string): boolean => {
  try {
    return nip19.decode(value).type === 'npub';
  } catch {
    return false;
  }
};

export const isNostrNsec = (value: string): boolean => {
  try {
    return nip19.decode(value).type === 'nsec';
  } catch {
    return false;
  }
};

const decodeNip19Key = (value: string, expected: 'npub' | 'nsec'): string => {
  const decoded = nip19.decode(value);
  if (decoded.type !== expected) {
    throw new Error(`Expected ${expected} key, received ${decoded.type}`);
  }
  const data = decoded.data as Uint8Array | string;
  if (typeof data === 'string') {
    return data;
  }
  return Buffer.from(data).toString('hex');
};

export const decodeNpubToHex = (value: string): string => decodeNip19Key(value, 'npub');

export const decodeNsecToHex = (value: string): string => decodeNip19Key(value, 'nsec');

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
  if (isNostrNpub(value)) {
    return publicKeyFromHex(decodeNpubToHex(value));
  }
  return createPublicKey(value);
};

export const parsePrivateKey = (value: string): KeyObject => {
  if (isHexKey(value)) {
    return privateKeyFromHex(value);
  }
  if (isNostrNsec(value)) {
    return privateKeyFromHex(decodeNsecToHex(value));
  }
  return createPrivateKey(value);
};

const stripPrefix = (keyDer: Buffer, prefix: Buffer, label: string): string => {
  if (!keyDer.subarray(0, prefix.length).equals(prefix)) {
    throw new Error(`${label} key does not match expected Ed25519 DER prefix`);
  }
  return keyDer.subarray(prefix.length).toString('hex');
};

export const exportPublicKeyHex = (key: KeyObject): string => {
  const spki = key.export({ format: 'der', type: 'spki' }) as Buffer;
  return stripPrefix(spki, ED25519_SPKI_PREFIX, 'public');
};

export const exportPrivateKeyHex = (key: KeyObject): string => {
  const pkcs8 = key.export({ format: 'der', type: 'pkcs8' }) as Buffer;
  return stripPrefix(pkcs8, ED25519_PKCS8_PREFIX, 'private');
};

export const exportPublicKeyNpub = (key: KeyObject): string => {
  const hex = exportPublicKeyHex(key);
  return nip19.npubEncode(hex);
};

export const exportPrivateKeyNsec = (key: KeyObject): string => {
  const hex = exportPrivateKeyHex(key);
  return nip19.nsecEncode(Buffer.from(hex, 'hex'));
};

export const exportPrivateKeyNpub = (key: KeyObject): string => {
  const hex = exportPrivateKeyHex(key);
  const pubkey = getPublicKey(Buffer.from(hex, 'hex'));
  return nip19.npubEncode(pubkey);
};

export const derivePublicKeyHex = (key: KeyObject): string => {
  const hex = exportPrivateKeyHex(key);
  return getPublicKey(Buffer.from(hex, 'hex'));
};
