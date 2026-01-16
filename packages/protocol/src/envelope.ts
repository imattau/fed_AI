import type { Envelope } from './types';

export const buildEnvelope = <T>(payload: T, nonce: string, ts: number, keyId: string): Envelope<T> => {
  return {
    payload,
    nonce,
    ts,
    keyId,
    sig: '',
  };
};

export type { Envelope };
