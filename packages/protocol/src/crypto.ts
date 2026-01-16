import { sign, verify, KeyObject } from 'node:crypto';
import type { Envelope } from './types';

export type KeyLike = string | Buffer | KeyObject;

type EnvelopeSigningPayload<T> = {
  payload: T;
  nonce: string;
  ts: number;
  keyId: string;
};

const stableStringify = (value: unknown): string => {
  if (value === null || value === undefined) {
    return 'null';
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(String(value));
};

const envelopeSigningPayload = <T>(envelope: Envelope<T>): EnvelopeSigningPayload<T> => {
  return {
    payload: envelope.payload,
    nonce: envelope.nonce,
    ts: envelope.ts,
    keyId: envelope.keyId,
  };
};

const encodeEnvelope = <T>(envelope: Envelope<T>): Buffer => {
  const payload = envelopeSigningPayload(envelope);
  const serialized = stableStringify(payload);
  return Buffer.from(serialized, 'utf8');
};

export const signEnvelope = <T>(envelope: Envelope<T>, privateKey: KeyLike): Envelope<T> => {
  const data = encodeEnvelope(envelope);
  const signature = sign(null, data, privateKey);
  return {
    ...envelope,
    sig: signature.toString('base64'),
  };
};

export const verifyEnvelope = <T>(envelope: Envelope<T>, publicKey: KeyLike): boolean => {
  const data = encodeEnvelope(envelope);
  const signature = Buffer.from(envelope.sig, 'base64');
  return verify(null, data, publicKey, signature);
};
