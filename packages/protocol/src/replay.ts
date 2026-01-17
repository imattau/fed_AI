import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
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
  cleanupIntervalMs?: number;
};

export class FileNonceStore implements NonceStore {
  private nonces = new Map<string, number>();
  private filePath: string;
  private persistIntervalMs: number;
  private cleanupIntervalMs: number;
  private lastPersistMs = 0;
  private lastCleanupMs = 0;
  private persistTimer: NodeJS.Timeout | null = null;
  private persistInFlight = false;
  private persistQueued = false;

  constructor(filePath: string, options: FileNonceStoreOptions = {}) {
    this.filePath = filePath;
    this.persistIntervalMs = options.persistIntervalMs ?? 1000;
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? 1000;
    this.load();
  }

  has(nonce: string): boolean {
    return this.nonces.has(nonce);
  }

  add(nonce: string, ts: number): void {
    this.nonces.set(nonce, ts);
    this.schedulePersist();
  }

  cleanup(cutoffTs: number): void {
    const nowMs = Date.now();
    if (nowMs - this.lastCleanupMs < this.cleanupIntervalMs) {
      return;
    }
    this.lastCleanupMs = nowMs;
    for (const [nonce, ts] of this.nonces.entries()) {
      if (ts < cutoffTs) {
        this.nonces.delete(nonce);
      }
    }
    this.schedulePersist();
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

  private schedulePersist(): void {
    if (this.persistTimer) {
      this.persistQueued = true;
      return;
    }
    this.persistQueued = false;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persist();
    }, this.persistIntervalMs);
  }

  private async persist(): Promise<void> {
    if (this.persistInFlight) {
      this.persistQueued = true;
      return;
    }
    this.persistInFlight = true;
    const entries: Record<string, number> = {};
    for (const [nonce, ts] of this.nonces.entries()) {
      entries[nonce] = ts;
    }
    const payload = JSON.stringify({ entries });
    const tmpPath = `${this.filePath}.tmp`;
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(tmpPath, payload);
      await rename(tmpPath, this.filePath);
    } finally {
      this.lastPersistMs = Date.now();
      this.persistInFlight = false;
      if (this.persistQueued) {
        this.schedulePersist();
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
