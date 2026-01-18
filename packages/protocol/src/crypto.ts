import stableStringify from 'fast-json-stable-stringify';
import type { Envelope, RouterControlMessage, RouterReceipt } from './types';
import { sha256 } from '@noble/hashes/sha256';
import { schnorr } from '@noble/curves/secp256k1';
import { decodeNpubToHex, decodeNsecToHex, isNostrNpub, isNostrNsec } from './keys';

export type KeyLike = string | Uint8Array;

type EnvelopeSigningPayload<T> = {
  payload: T;
  nonce: string;
  ts: number;
  keyId: string;
};

const envelopeSigningPayload = <T>(envelope: Envelope<T>): EnvelopeSigningPayload<T> => {
  return {
    payload: envelope.payload,
    nonce: envelope.nonce,
    ts: envelope.ts,
    keyId: envelope.keyId,
  };
};

const encodeEnvelope = <T>(envelope: Envelope<T>): Uint8Array => {
  const payload = envelopeSigningPayload(envelope);
  const serialized = stableStringify(payload);
  return new TextEncoder().encode(serialized);
};

const encodeRouterMessage = <T>(message: RouterControlMessage<T>): Uint8Array => {
  const sanitized = { ...message, sig: undefined };
  const serialized = stableStringify(sanitized);
  return new TextEncoder().encode(serialized);
};

const encodeRouterReceipt = (receipt: RouterReceipt): Uint8Array => {
  const sanitized = { ...receipt, sig: undefined };
  const serialized = stableStringify(sanitized);
  return new TextEncoder().encode(serialized);
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

const hashBytes = (payload: Uint8Array): Uint8Array => {
  return sha256(payload);
};

export const signEnvelope = <T>(envelope: Envelope<T>, privateKey: KeyLike): Envelope<T> => {
  const data = encodeEnvelope(envelope);
  const hash = hashBytes(data);
  const signature = schnorr.sign(hash, normalizePrivateKey(privateKey));
  return {
    ...envelope,
    sig: Buffer.from(signature).toString('base64'),
  };
};

export const verifyEnvelope = <T>(envelope: Envelope<T>, publicKey: KeyLike): boolean => {
  const data = encodeEnvelope(envelope);
  const hash = hashBytes(data);
  const signature = Buffer.from(envelope.sig, 'base64');
  const result = schnorr.verify(signature, hash, normalizePublicKey(publicKey));
  return Boolean(result);
};

export const signRouterMessage = <T>(
  message: RouterControlMessage<T>,
  privateKey: KeyLike,
): RouterControlMessage<T> => {
  const data = encodeRouterMessage(message);
  const hash = hashBytes(data);
  const signature = schnorr.sign(hash, normalizePrivateKey(privateKey));
  return {
    ...message,
    sig: Buffer.from(signature).toString('base64'),
  };
};

export const verifyRouterMessage = <T>(
  message: RouterControlMessage<T>,
  publicKey: KeyLike,
): boolean => {
  const data = encodeRouterMessage(message);
  const hash = hashBytes(data);
  const signature = Buffer.from(message.sig, 'base64');
  const result = schnorr.verify(signature, hash, normalizePublicKey(publicKey));
  return Boolean(result);
};

export const signRouterReceipt = (receipt: RouterReceipt, privateKey: KeyLike): RouterReceipt => {
  const data = encodeRouterReceipt(receipt);
  const hash = hashBytes(data);
  const signature = schnorr.sign(hash, normalizePrivateKey(privateKey));
  return {
    ...receipt,
    sig: Buffer.from(signature).toString('base64'),
  };
};

export const verifyRouterReceipt = (receipt: RouterReceipt, publicKey: KeyLike): boolean => {
  const data = encodeRouterReceipt(receipt);
  const hash = hashBytes(data);
  const signature = Buffer.from(receipt.sig, 'base64');
  const result = schnorr.verify(signature, hash, normalizePublicKey(publicKey));
  return Boolean(result);
};
