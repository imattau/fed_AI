import stableStringify from 'fast-json-stable-stringify';
import type { ManifestSignature, NodeManifest, RouterManifest } from './types';
import { sha256 } from '@noble/hashes/sha256';
import { schnorr } from '@noble/curves/secp256k1';
import { decodeNpubToHex, decodeNsecToHex, isNostrNpub, isNostrNsec } from '@fed-ai/protocol';

export type KeyLike = string | Uint8Array;

const hashManifest = (manifest: NodeManifest | RouterManifest): string => {
  const sanitized = { ...manifest, signature: undefined };
  const payload = stableStringify(sanitized);
  return Buffer.from(sha256(new TextEncoder().encode(payload))).toString('hex');
};

const normalizePrivateKey = (key: KeyLike): Uint8Array => {
  if (key instanceof Uint8Array) {
    return key;
  }
  if (isNostrNsec(key)) {
    return Buffer.from(decodeNsecToHex(key), 'hex');
  }
  if (/^[0-9a-fA-F]{64}$/.test(key)) {
    return Buffer.from(key, 'hex');
  }
  throw new Error('unsupported private key format');
};

const normalizePublicKey = (key: KeyLike): Uint8Array => {
  if (key instanceof Uint8Array) {
    return key;
  }
  if (isNostrNpub(key)) {
    return Buffer.from(decodeNpubToHex(key), 'hex');
  }
  if (/^[0-9a-fA-F]{64}$/.test(key)) {
    return Buffer.from(key, 'hex');
  }
  throw new Error('unsupported public key format');
};

export const signManifest = (
  manifest: NodeManifest | RouterManifest,
  keyId: string,
  privateKey: KeyLike,
): NodeManifest | RouterManifest => {
  const payload = stableStringify({ ...manifest, signature: undefined });
  const hash = sha256(new TextEncoder().encode(payload));
  const signature = Buffer.from(schnorr.sign(hash, normalizePrivateKey(privateKey))).toString('base64');

  const signatureBlock: ManifestSignature = {
    signature,
    keyId,
    signedAtMs: Date.now(),
  };

  return {
    ...manifest,
    signature: signatureBlock,
  };
};

export const verifyManifest = (manifest: NodeManifest | RouterManifest, publicKey: KeyLike): boolean => {
  if (!manifest.signature) {
    return false;
  }
  const payload = stableStringify({ ...manifest, signature: undefined });
  const hash = sha256(new TextEncoder().encode(payload));
  const signature = Buffer.from(manifest.signature.signature, 'base64');
  const result = schnorr.verify(signature, hash, normalizePublicKey(publicKey));
  return Boolean(result);
};

export const manifestHash = (manifest: NodeManifest | RouterManifest): string => {
  return hashManifest(manifest);
};

export type { NodeManifest, RouterManifest, ManifestSignature, RelayDiscoverySnapshot } from './types';
