import type { Envelope } from './types';

export const DEFAULT_REPLAY_WINDOW_MS = 5 * 60 * 1000;

export type ReplayOptions = {
  windowMs?: number;
  nowMs?: number;
};

export type ReplayCheckResult = {
  ok: boolean;
  error?: 'nonce-reused' | 'ts-out-of-window';
};

export interface NonceStore {
  has(nonce: string): boolean;
  add(nonce: string, ts: number): void;
  cleanup(cutoffTs: number): void;
}

export class InMemoryNonceStore implements NonceStore {
  private nonces = new Map<string, number>();

  has(nonce: string): boolean {
    return this.nonces.has(nonce);
  }

  add(nonce: string, ts: number): void {
    this.nonces.set(nonce, ts);
  }

  cleanup(cutoffTs: number): void {
    for (const [nonce, ts] of this.nonces.entries()) {
      if (ts < cutoffTs) {
        this.nonces.delete(nonce);
      }
    }
  }
}

export const checkReplay = (
  envelope: Envelope<unknown>,
  store: NonceStore,
  options: ReplayOptions = {},
): ReplayCheckResult => {
  const nowMs = options.nowMs ?? Date.now();
  const windowMs = options.windowMs ?? DEFAULT_REPLAY_WINDOW_MS;

  if (Math.abs(nowMs - envelope.ts) > windowMs) {
    return { ok: false, error: 'ts-out-of-window' };
  }

  if (store.has(envelope.nonce)) {
    return { ok: false, error: 'nonce-reused' };
  }

  store.add(envelope.nonce, envelope.ts);
  store.cleanup(nowMs - windowMs);
  return { ok: true };
};
