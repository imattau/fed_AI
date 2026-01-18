import { Pool } from 'pg';
import { DEFAULT_REPLAY_WINDOW_MS } from '@fed-ai/protocol';
import type { NonceStore } from '@fed-ai/protocol';

type PendingEntry = { nonce: string; ts: number };

export class PostgresNonceStore implements NonceStore {
  private pool: Pool;
  private table: string;
  private nonces = new Map<string, number>();
  private pending: PendingEntry[] = [];
  private pendingCleanupTs: number | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private flushInFlight = false;
  private flushIntervalMs = 250;

  constructor(pool: Pool, table = 'node_nonce_store') {
    this.pool = pool;
    this.table = table;
  }

  async init(windowMs = DEFAULT_REPLAY_WINDOW_MS): Promise<void> {
    await this.pool.query(`
      create table if not exists ${this.table} (
        nonce text primary key,
        ts bigint not null,
        updated_at timestamptz not null default now()
      );
    `);
    const cutoff = Date.now() - windowMs;
    const result = await this.pool.query<{ nonce: string; ts: number }>(
      `select nonce, ts from ${this.table} where ts >= $1`,
      [cutoff],
    );
    for (const row of result.rows) {
      this.nonces.set(row.nonce, row.ts);
    }
  }

  has(nonce: string): boolean {
    return this.nonces.has(nonce);
  }

  add(nonce: string, ts: number): void {
    this.nonces.set(nonce, ts);
    this.pending.push({ nonce, ts });
    this.scheduleFlush();
  }

  cleanup(cutoffTs: number): void {
    for (const [nonce, ts] of this.nonces.entries()) {
      if (ts < cutoffTs) {
        this.nonces.delete(nonce);
      }
    }
    this.pendingCleanupTs = cutoffTs;
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.flushIntervalMs);
  }

  private async flush(): Promise<void> {
    if (this.flushInFlight) {
      this.scheduleFlush();
      return;
    }
    this.flushInFlight = true;
    const inserts = this.pending.splice(0, this.pending.length);
    const cleanupTs = this.pendingCleanupTs;
    this.pendingCleanupTs = null;
    try {
      if (inserts.length > 0) {
        const values: string[] = [];
        const params: Array<string | number> = [];
        inserts.forEach((entry, index) => {
          const base = index * 2;
          values.push(`($${base + 1}, $${base + 2})`);
          params.push(entry.nonce, entry.ts);
        });
        await this.pool.query(
          `insert into ${this.table} (nonce, ts) values ${values.join(',')}
           on conflict (nonce) do update set ts = excluded.ts, updated_at = now()`,
          params,
        );
      }
      if (cleanupTs !== null) {
        await this.pool.query(`delete from ${this.table} where ts < $1`, [cleanupTs]);
      }
    } finally {
      this.flushInFlight = false;
      if (this.pending.length > 0 || this.pendingCleanupTs !== null) {
        this.scheduleFlush();
      }
    }
  }
}

export const createPostgresNonceStore = async (url: string): Promise<PostgresNonceStore> => {
  const pool = new Pool({ connectionString: url });
  const store = new PostgresNonceStore(pool);
  await store.init();
  return store;
};
