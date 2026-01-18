import type { RouterConfig } from './config';
import type { RouterService } from './server';

const pruneMapByTimestamp = <T>(
  map: Map<string, T>,
  getTimestamp: (value: T) => number | undefined,
  cutoffMs: number,
): void => {
  for (const [key, value] of map.entries()) {
    const timestamp = getTimestamp(value);
    if (timestamp !== undefined && timestamp < cutoffMs) {
      map.delete(key);
    }
  }
};

const pruneNodeHealth = (
  service: RouterService,
  cutoffMs: number,
): void => {
  for (const [nodeId, entry] of service.nodeHealth.entries()) {
    const lastSeen = Math.max(entry.lastFailureMs, entry.lastSuccessMs);
    if (lastSeen > 0 && lastSeen < cutoffMs) {
      service.nodeHealth.delete(nodeId);
    }
  }
};

const pruneNodes = (service: RouterService, cutoffMs: number): void => {
  service.nodes = service.nodes.filter((node) => {
    if (!node.lastHeartbeatMs) {
      return true;
    }
    return node.lastHeartbeatMs >= cutoffMs;
  });
};

const pruneNodeCooldown = (service: RouterService, nowMs: number, cutoffMs?: number): void => {
  for (const [nodeId, cooldownUntil] of service.nodeCooldown.entries()) {
    if (cooldownUntil <= nowMs || (cutoffMs !== undefined && cooldownUntil < cutoffMs)) {
      service.nodeCooldown.delete(nodeId);
    }
  }
};

const pruneFederationJobs = (
  service: RouterService,
  cutoffMs: number,
): void => {
  for (const [jobId, entry] of service.federation.jobs.entries()) {
    if (entry.updatedAtMs < cutoffMs) {
      service.federation.jobs.delete(jobId);
    }
  }
  for (const [jobId, entry] of service.federation.outboundJobs.entries()) {
    if (entry.updatedAtMs < cutoffMs) {
      service.federation.outboundJobs.delete(jobId);
    }
  }
  for (const [jobId, entry] of service.federation.outboundAwards.entries()) {
    if (entry.payload.awardExpiry < cutoffMs) {
      service.federation.outboundAwards.delete(jobId);
    }
  }
};

export const pruneRouterState = (service: RouterService, config: RouterConfig): void => {
  const nowMs = Date.now();

  if (config.paymentRequestRetentionMs !== undefined) {
    pruneMapByTimestamp(
      service.paymentRequests,
      (request) => request.expiresAtMs,
      nowMs - config.paymentRequestRetentionMs,
    );
    pruneMapByTimestamp(
      service.federationPaymentRequests,
      (request) => request.expiresAtMs,
      nowMs - config.paymentRequestRetentionMs,
    );
  }

  if (config.paymentReceiptRetentionMs !== undefined) {
    pruneMapByTimestamp(
      service.paymentReceipts,
      (receipt) => receipt.payload.paidAtMs,
      nowMs - config.paymentReceiptRetentionMs,
    );
    pruneMapByTimestamp(
      service.federationPaymentReceipts,
      (receipt) => receipt.payload.paidAtMs,
      nowMs - config.paymentReceiptRetentionMs,
    );
  }

  if (config.federationJobRetentionMs !== undefined) {
    pruneFederationJobs(service, nowMs - config.federationJobRetentionMs);
  }

  if (config.nodeHealthRetentionMs !== undefined) {
    pruneNodeHealth(service, nowMs - config.nodeHealthRetentionMs);
  }

  if (config.nodeRetentionMs !== undefined) {
    pruneNodes(service, nowMs - config.nodeRetentionMs);
  }

  if (config.nodeCooldownRetentionMs !== undefined) {
    pruneNodeCooldown(service, nowMs, nowMs - config.nodeCooldownRetentionMs);
  } else {
    pruneNodeCooldown(service, nowMs);
  }
};
