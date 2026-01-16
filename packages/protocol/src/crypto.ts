import { sign, verify, KeyObject } from 'node:crypto';
import stableStringify from 'fast-json-stable-stringify';
import type { Envelope, RouterControlMessage, RouterReceipt } from './types';

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

const encodeRouterMessage = <T>(message: RouterControlMessage<T>): Buffer => {
  const sanitized = { ...message, sig: undefined };
  const serialized = stableStringify(sanitized);
  return Buffer.from(serialized, 'utf8');
};

const encodeRouterReceipt = (receipt: RouterReceipt): Buffer => {
  const sanitized = { ...receipt, sig: undefined };
  const serialized = stableStringify(sanitized);
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

export const signRouterMessage = <T>(
  message: RouterControlMessage<T>,
  privateKey: KeyLike,
): RouterControlMessage<T> => {
  const data = encodeRouterMessage(message);
  const signature = sign(null, data, privateKey);
  return {
    ...message,
    sig: signature.toString('base64'),
  };
};

export const verifyRouterMessage = <T>(
  message: RouterControlMessage<T>,
  publicKey: KeyLike,
): boolean => {
  const data = encodeRouterMessage(message);
  const signature = Buffer.from(message.sig, 'base64');
  return verify(null, data, publicKey, signature);
};

export const signRouterReceipt = (receipt: RouterReceipt, privateKey: KeyLike): RouterReceipt => {
  const data = encodeRouterReceipt(receipt);
  const signature = sign(null, data, privateKey);
  return {
    ...receipt,
    sig: signature.toString('base64'),
  };
};

export const verifyRouterReceipt = (receipt: RouterReceipt, publicKey: KeyLike): boolean => {
  const data = encodeRouterReceipt(receipt);
  const signature = Buffer.from(receipt.sig, 'base64');
  return verify(null, data, publicKey, signature);
};
