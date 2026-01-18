import { Pool } from 'pg';
import type { QueryResultRow } from 'pg';
import type { Envelope, NodeDescriptor, PaymentReceipt, PaymentRequest } from '@fed-ai/protocol';
import type { NodeManifest } from '@fed-ai/manifest';
import type { RouterDbConfig } from '../config';
import type { RouterStore, RouterStoreSnapshot } from './types';

const TABLES = {
  nodes: 'router_nodes',
  paymentRequests: 'router_payment_requests',
  paymentReceipts: 'router_payment_receipts',
  manifests: 'router_manifests',
  manifestAdmissions: 'router_manifest_admissions',
};

export type RouterStoreRetention = {
  nodeRetentionMs?: number;
  paymentRequestRetentionMs?: number;
  paymentReceiptRetentionMs?: number;
  manifestRetentionMs?: number;
  manifestAdmissionRetentionMs?: number;
};

const createTables = async (pool: Pool): Promise<void> => {
  await pool.query(`
    create table if not exists ${TABLES.nodes} (
      node_id text primary key,
      data jsonb not null,
      updated_at timestamptz not null default now()
    );
  `);
  await pool.query(`
    create table if not exists ${TABLES.paymentRequests} (
      request_key text primary key,
      data jsonb not null,
      updated_at timestamptz not null default now()
    );
  `);
  await pool.query(`
    create table if not exists ${TABLES.paymentReceipts} (
      receipt_key text primary key,
      data jsonb not null,
      updated_at timestamptz not null default now()
    );
  `);
  await pool.query(`
    create table if not exists ${TABLES.manifests} (
      manifest_id text primary key,
      data jsonb not null,
      updated_at timestamptz not null default now()
    );
  `);
  await pool.query(`
    create table if not exists ${TABLES.manifestAdmissions} (
      node_id text primary key,
      eligible boolean not null,
      reason text,
      updated_at timestamptz not null default now()
    );
  `);
};

const buildCutoff = (retentionMs?: number): number | null => {
  if (!retentionMs) {
    return null;
  }
  return Date.now() - retentionMs;
};

const maybeCleanup = async (pool: Pool, table: string, cutoffMs: number | null): Promise<void> => {
  if (cutoffMs === null) {
    return;
  }
  await pool.query(
    `delete from ${table} where updated_at < to_timestamp($1 / 1000.0)`,
    [cutoffMs],
  );
};

const queryWithRetention = async <T extends QueryResultRow>(
  pool: Pool,
  table: string,
  columns: string,
  cutoffMs: number | null,
): Promise<{ rows: T[] }> => {
  if (cutoffMs === null) {
    return pool.query<T>(`select ${columns} from ${table}`);
  }
  return pool.query<T>(
    `select ${columns} from ${table} where updated_at >= to_timestamp($1 / 1000.0)`,
    [cutoffMs],
  );
};

export const createPostgresRouterStore = async (
  config: RouterDbConfig,
  retention: RouterStoreRetention = {},
): Promise<RouterStore> => {
  const pool = new Pool({
    connectionString: config.url,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
  });
  await createTables(pool);

  return {
    async load(): Promise<RouterStoreSnapshot> {
      const nodeCutoff = buildCutoff(retention.nodeRetentionMs);
      const requestCutoff = buildCutoff(retention.paymentRequestRetentionMs);
      const receiptCutoff = buildCutoff(retention.paymentReceiptRetentionMs);
      const manifestCutoff = buildCutoff(retention.manifestRetentionMs);
      const admissionCutoff = buildCutoff(retention.manifestAdmissionRetentionMs);

      await Promise.all([
        maybeCleanup(pool, TABLES.nodes, nodeCutoff),
        maybeCleanup(pool, TABLES.paymentRequests, requestCutoff),
        maybeCleanup(pool, TABLES.paymentReceipts, receiptCutoff),
        maybeCleanup(pool, TABLES.manifests, manifestCutoff),
        maybeCleanup(pool, TABLES.manifestAdmissions, admissionCutoff),
      ]);

      const nodes = await queryWithRetention<{ node_id: string; data: NodeDescriptor }>(
        pool,
        TABLES.nodes,
        'node_id, data',
        nodeCutoff,
      );
      const paymentRequests = await queryWithRetention<{ request_key: string; data: PaymentRequest }>(
        pool,
        TABLES.paymentRequests,
        'request_key, data',
        requestCutoff,
      );
      const paymentReceipts = await queryWithRetention<{ receipt_key: string; data: Envelope<PaymentReceipt> }>(
        pool,
        TABLES.paymentReceipts,
        'receipt_key, data',
        receiptCutoff,
      );
      const manifests = await queryWithRetention<{ manifest_id: string; data: NodeManifest }>(
        pool,
        TABLES.manifests,
        'manifest_id, data',
        manifestCutoff,
      );
      const admissions = await queryWithRetention<{ node_id: string; eligible: boolean; reason: string | null }>(
        pool,
        TABLES.manifestAdmissions,
        'node_id, eligible, reason',
        admissionCutoff,
      );

      return {
        nodes: nodes.rows.map((row) => row.data),
        paymentRequests: paymentRequests.rows.map((row) => ({
          key: row.request_key,
          request: row.data,
        })),
        paymentReceipts: paymentReceipts.rows.map((row) => ({
          key: row.receipt_key,
          receipt: row.data,
        })),
        manifests: manifests.rows.map((row) => row.data),
        manifestAdmissions: admissions.rows.map((row) => ({
          nodeId: row.node_id,
          eligible: row.eligible,
          reason: row.reason ?? undefined,
        })),
      };
    },

    async saveNode(node: NodeDescriptor): Promise<void> {
      await pool.query(
        `insert into ${TABLES.nodes} (node_id, data) values ($1, $2)
         on conflict (node_id) do update set data = excluded.data, updated_at = now()`,
        [node.nodeId, node],
      );
    },

    async savePaymentRequest(key: string, request: PaymentRequest): Promise<void> {
      await pool.query(
        `insert into ${TABLES.paymentRequests} (request_key, data) values ($1, $2)
         on conflict (request_key) do update set data = excluded.data, updated_at = now()`,
        [key, request],
      );
    },

    async savePaymentReceipt(key: string, receipt: Envelope<PaymentReceipt>): Promise<void> {
      await pool.query(
        `insert into ${TABLES.paymentReceipts} (receipt_key, data) values ($1, $2)
         on conflict (receipt_key) do update set data = excluded.data, updated_at = now()`,
        [key, receipt],
      );
    },

    async saveManifest(manifest: NodeManifest): Promise<void> {
      await pool.query(
        `insert into ${TABLES.manifests} (manifest_id, data) values ($1, $2)
         on conflict (manifest_id) do update set data = excluded.data, updated_at = now()`,
        [manifest.id, manifest],
      );
    },

    async saveManifestAdmission(
      nodeId: string,
      admission: { eligible: boolean; reason?: string },
    ): Promise<void> {
      await pool.query(
        `insert into ${TABLES.manifestAdmissions} (node_id, eligible, reason) values ($1, $2, $3)
         on conflict (node_id) do update set eligible = excluded.eligible, reason = excluded.reason, updated_at = now()`,
        [nodeId, admission.eligible, admission.reason ?? null],
      );
    },
  };
};
