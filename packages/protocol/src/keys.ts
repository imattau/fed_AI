import { getPublicKey, nip19 } from 'nostr-tools';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

const isHexKey = (value: string): boolean => /^[0-9a-fA-F]{64}$/.test(value);

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
  return bytesToHex(data);
};

export const decodeNpubToHex = (value: string): string => decodeNip19Key(value, 'npub');

export const decodeNsecToHex = (value: string): string => decodeNip19Key(value, 'nsec');

export const parsePublicKey = (value: string): Uint8Array => {
  if (isHexKey(value)) {
    return hexToBytes(value);
  }
  if (isNostrNpub(value)) {
    return hexToBytes(decodeNpubToHex(value));
  }
  throw new Error('unsupported public key format');
};

export const parsePrivateKey = (value: string): Uint8Array => {
  if (isHexKey(value)) {
    return hexToBytes(value);
  }
  if (isNostrNsec(value)) {
    return hexToBytes(decodeNsecToHex(value));
  }
  throw new Error('unsupported private key format');
};

export const exportPublicKeyHex = (key: Uint8Array): string => bytesToHex(key);

export const exportPrivateKeyHex = (key: Uint8Array): string => bytesToHex(key);

export const exportPublicKeyNpub = (key: Uint8Array): string => nip19.npubEncode(bytesToHex(key));

export const exportPrivateKeyNsec = (key: Uint8Array): string => nip19.nsecEncode(key);

export const exportPrivateKeyNpub = (key: Uint8Array): string => {
  const pubkey = getPublicKey(key);
  return nip19.npubEncode(pubkey);
};

export const derivePublicKeyHex = (key: Uint8Array): string => {
  return getPublicKey(key);
};
