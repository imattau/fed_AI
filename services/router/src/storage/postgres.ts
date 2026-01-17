import { Pool } from 'pg';
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

export const createPostgresRouterStore = async (config: RouterDbConfig): Promise<RouterStore> => {
  const pool = new Pool({
    connectionString: config.url,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
  });
  await createTables(pool);

  return {
    async load(): Promise<RouterStoreSnapshot> {
      const nodes = await pool.query<{ node_id: string; data: NodeDescriptor }>(
        `select node_id, data from ${TABLES.nodes}`,
      );
      const paymentRequests = await pool.query<{ request_key: string; data: PaymentRequest }>(
        `select request_key, data from ${TABLES.paymentRequests}`,
      );
      const paymentReceipts = await pool.query<{ receipt_key: string; data: Envelope<PaymentReceipt> }>(
        `select receipt_key, data from ${TABLES.paymentReceipts}`,
      );
      const manifests = await pool.query<{ manifest_id: string; data: NodeManifest }>(
        `select manifest_id, data from ${TABLES.manifests}`,
      );
      const admissions = await pool.query<{ node_id: string; eligible: boolean; reason: string | null }>(
        `select node_id, eligible, reason from ${TABLES.manifestAdmissions}`,
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
