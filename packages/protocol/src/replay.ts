import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
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

type FileNonceStoreOptions = {
  persistIntervalMs?: number;
};

export class FileNonceStore implements NonceStore {
  private nonces = new Map<string, number>();
  private filePath: string;
  private persistIntervalMs: number;
  private lastPersistMs = 0;

  constructor(filePath: string, options: FileNonceStoreOptions = {}) {
    this.filePath = filePath;
    this.persistIntervalMs = options.persistIntervalMs ?? 1000;
    this.load();
  }

  has(nonce: string): boolean {
    return this.nonces.has(nonce);
  }

  add(nonce: string, ts: number): void {
    this.nonces.set(nonce, ts);
    this.persistIfNeeded();
  }

  cleanup(cutoffTs: number): void {
    for (const [nonce, ts] of this.nonces.entries()) {
      if (ts < cutoffTs) {
        this.nonces.delete(nonce);
      }
    }
    this.persistIfNeeded();
  }

  private load(): void {
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as { entries?: Record<string, number> };
      if (parsed.entries) {
        for (const [nonce, ts] of Object.entries(parsed.entries)) {
          if (Number.isFinite(ts)) {
            this.nonces.set(nonce, ts);
          }
        }
      }
    } catch {
      // missing or invalid file is treated as empty store
    }
  }

  private persistIfNeeded(): void {
    const nowMs = Date.now();
    if (nowMs - this.lastPersistMs < this.persistIntervalMs) {
      return;
    }
    this.lastPersistMs = nowMs;
    this.persist();
  }

  private persist(): void {
    const entries: Record<string, number> = {};
    for (const [nonce, ts] of this.nonces.entries()) {
      entries[nonce] = ts;
    }
    const payload = JSON.stringify({ entries });
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(tmpPath, payload);
    renameSync(tmpPath, this.filePath);
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
