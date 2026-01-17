import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  Envelope,
  NodeDescriptor,
  PaymentReceipt,
  PaymentRequest,
  StakeCommit,
  StakeSlash,
} from '@fed-ai/protocol';
import type { NodeManifest } from '@fed-ai/manifest';
import type { RouterService } from './server';
import { logWarn } from './logging';

type ManifestAdmissionSnapshot = { nodeId: string; eligible: boolean; reason?: string };
type NodeHealthSnapshot = {
  successes: number;
  failures: number;
  consecutiveFailures: number;
  lastFailureMs: number;
  lastSuccessMs: number;
};

type RouterStateSnapshot = {
  capturedAtMs: number;
  nodes: NodeDescriptor[];
  paymentRequests: PaymentRequest[];
  paymentReceipts: Envelope<PaymentReceipt>[];
  federationPaymentRequests: PaymentRequest[];
  federationPaymentReceipts: Envelope<PaymentReceipt>[];
  manifests: NodeManifest[];
  manifestAdmissions: ManifestAdmissionSnapshot[];
  nodeCooldown: Record<string, number>;
  nodeHealth: Record<string, NodeHealthSnapshot>;
  stake: {
    commits: Array<{ commit: StakeCommit; envelope: Envelope<StakeCommit> }>;
    slashes: StakeSlash[];
  };
};

const toRecord = <T>(map: Map<string, T>): Record<string, T> => {
  const result: Record<string, T> = {};
  for (const [key, value] of map.entries()) {
    result[key] = value;
  }
  return result;
};

const fromRecord = <T>(record: Record<string, T> | undefined): Map<string, T> => {
  const map = new Map<string, T>();
  if (!record) {
    return map;
  }
  for (const [key, value] of Object.entries(record)) {
    map.set(key, value);
  }
  return map;
};

const buildSnapshot = (service: RouterService): RouterStateSnapshot => ({
  capturedAtMs: Date.now(),
  nodes: service.nodes,
  paymentRequests: Array.from(service.paymentRequests.values()),
  paymentReceipts: Array.from(service.paymentReceipts.values()),
  federationPaymentRequests: Array.from(service.federationPaymentRequests.values()),
  federationPaymentReceipts: Array.from(service.federationPaymentReceipts.values()),
  manifests: Array.from(service.manifests.values()),
  manifestAdmissions: Array.from(service.manifestAdmissions.entries()).map(
    ([nodeId, admission]) => ({
      nodeId,
      eligible: admission.eligible,
      reason: admission.reason,
    }),
  ),
  nodeCooldown: toRecord(service.nodeCooldown),
  nodeHealth: toRecord(service.nodeHealth),
  stake: {
    commits: Array.from(service.stakeStore.commits.values()),
    slashes: Array.from(service.stakeStore.slashes.values()),
  },
});

const persistSnapshot = async (snapshot: RouterStateSnapshot, filePath: string): Promise<void> => {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(snapshot));
  await rename(tmpPath, filePath);
};

export const loadRouterState = (service: RouterService, filePath?: string): void => {
  if (!filePath) {
    return;
  }
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as RouterStateSnapshot;
    if (parsed.nodes) {
      service.nodes = parsed.nodes;
    }
    if (parsed.paymentRequests) {
      service.paymentRequests = new Map(
        parsed.paymentRequests.map((request) => [
          `${request.requestId}:${request.payeeType}:${request.payeeId}`,
          request,
        ]),
      );
    }
    if (parsed.paymentReceipts) {
      service.paymentReceipts = new Map(
        parsed.paymentReceipts.map((receipt) => [
          `${receipt.payload.requestId}:${receipt.payload.payeeType}:${receipt.payload.payeeId}`,
          receipt,
        ]),
      );
    }
    if (parsed.federationPaymentRequests) {
      service.federationPaymentRequests = new Map(
        parsed.federationPaymentRequests.map((request) => [
          `${request.requestId}:${request.payeeType}:${request.payeeId}`,
          request,
        ]),
      );
    }
    if (parsed.federationPaymentReceipts) {
      service.federationPaymentReceipts = new Map(
        parsed.federationPaymentReceipts.map((receipt) => [
          `${receipt.payload.requestId}:${receipt.payload.payeeType}:${receipt.payload.payeeId}`,
          receipt,
        ]),
      );
    }
    if (parsed.manifests) {
      service.manifests = new Map(parsed.manifests.map((manifest) => [manifest.id, manifest]));
    }
    if (parsed.manifestAdmissions) {
      service.manifestAdmissions = new Map(
        parsed.manifestAdmissions.map((entry) => [
          entry.nodeId,
          { eligible: entry.eligible, reason: entry.reason },
        ]),
      );
    }
    if (parsed.nodeCooldown) {
      service.nodeCooldown = fromRecord(parsed.nodeCooldown);
    }
    if (parsed.nodeHealth) {
      service.nodeHealth = fromRecord(parsed.nodeHealth);
    }
    if (parsed.stake?.commits) {
      service.stakeStore.commits = new Map(
        parsed.stake.commits.map((record) => [record.commit.stakeId, record]),
      );
    }
    if (parsed.stake?.slashes) {
      service.stakeStore.slashes = new Map(
        parsed.stake.slashes.map((slash) => [slash.slashId, slash]),
      );
    }
  } catch (error) {
    logWarn('[router] failed to load state', error);
  }
};

export const startRouterStatePersistence = (
  service: RouterService,
  filePath?: string,
  intervalMs = 5000,
): void => {
  if (!filePath) {
    return;
  }
  let inFlight = false;
  let queued = false;
  const persist = () => {
    if (inFlight) {
      queued = true;
      return;
    }
    inFlight = true;
    const snapshot = buildSnapshot(service);
    persistSnapshot(snapshot, filePath)
      .catch((error) => {
        logWarn('[router] failed to persist state', error);
      })
      .finally(() => {
        inFlight = false;
        if (queued) {
          queued = false;
          persist();
        }
      });
  };
  persist();
  setInterval(persist, intervalMs);
};
