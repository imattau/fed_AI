import { sign, verify, KeyObject } from 'node:crypto';
import stableStringify from 'fast-json-stable-stringify';
import type { Envelope } from './types';

export type KeyLike = string | Buffer | KeyObject;

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
