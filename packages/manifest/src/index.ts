import { createHash, sign, verify, KeyObject } from 'node:crypto';
import stableStringify from 'fast-json-stable-stringify';
import type { ManifestSignature, NodeManifest, RouterManifest } from './types';

export type KeyLike = string | Buffer | KeyObject;

const hashManifest = (manifest: NodeManifest | RouterManifest): string => {
  const sanitized = { ...manifest, signature: undefined };
  const payload = stableStringify(sanitized);
  return createHash('sha256').update(payload).digest('hex');
};

export const signManifest = (
  manifest: NodeManifest | RouterManifest,
  keyId: string,
  privateKey: KeyLike,
): NodeManifest | RouterManifest => {
  const payload = stableStringify({ ...manifest, signature: undefined });
  const signature = sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64');

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
  const signature = Buffer.from(manifest.signature.signature, 'base64');
  return verify(null, Buffer.from(payload, 'utf8'), publicKey, signature);
};

export const manifestHash = (manifest: NodeManifest | RouterManifest): string => {
  return hashManifest(manifest);
};

export type { NodeManifest, RouterManifest, ManifestSignature, RelayDiscoverySnapshot } from './types';
