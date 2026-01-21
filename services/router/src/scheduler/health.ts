import type { RouterService } from '../server';
import { nodeFailureEvents } from '../observability';
import type { RelayDiscoverySnapshot, NodeManifest } from '@fed-ai/manifest';
import type { RelayAdmissionPolicy } from '../config';
import type { NodeDescriptor } from '@fed-ai/protocol';
import { effectiveStakeUnits } from '../accounting/staking';

export const NODE_HEARTBEAT_WINDOW_MS = 30_000;
export const NODE_FAILURE_THRESHOLD = 3;
export const NODE_FAILURE_BASE_COOLDOWN_MS = 30_000;
export const NODE_FAILURE_BACKOFF_CAP = 4;
export const NODE_RELIABILITY_SAMPLE_MIN = 5;
export const NODE_RELIABILITY_MAX_PENALTY = 20;
export const NODE_PERFORMANCE_SAMPLE_MIN = 10;
export const NODE_PERFORMANCE_BASELINE = 0.9;
export const NODE_PERFORMANCE_MAX_BONUS = 10;
export const MANIFEST_DECAY_SAMPLES = 20;
export const RELAY_DISCOVERY_CLOCK_SKEW_MS = 5 * 60 * 1000;

export const getNodeHealth = (service: RouterService, nodeId: string) => {
  const existing = service.nodeHealth.get(nodeId);
  if (existing) {
    return existing;
  }
  const entry = {
    successes: 0,
    failures: 0,
    consecutiveFailures: 0,
    lastFailureMs: 0,
    lastSuccessMs: 0,
  };
  service.nodeHealth.set(nodeId, entry);
  return entry;
};

export const assessRelayDiscoverySnapshot = (
  snapshot: RelayDiscoverySnapshot | null | undefined,
  policy: RelayAdmissionPolicy,
): { eligible: boolean; reason?: string } => {
  if (!snapshot) {
    return policy.requireSnapshot ? { eligible: false, reason: 'missing-relay-discovery' } : { eligible: true };
  }

  if (!snapshot.discoveredAtMs || Number.isNaN(snapshot.discoveredAtMs)) {
    return { eligible: false, reason: 'relay-discovery-missing-timestamp' };
  }

  const now = Date.now();
  if (snapshot.discoveredAtMs > now + RELAY_DISCOVERY_CLOCK_SKEW_MS) {
    return { eligible: false, reason: 'relay-discovery-future-timestamp' };
  }
  if (now - snapshot.discoveredAtMs > policy.maxAgeMs) {
    return { eligible: false, reason: 'relay-discovery-expired' };
  }

  if (!snapshot.relays || snapshot.relays.length === 0) {
    return { eligible: false, reason: 'relay-discovery-empty' };
  }

  if (policy.minScore !== undefined) {
    if (snapshot.options.minScore === undefined || snapshot.options.minScore < policy.minScore) {
      return { eligible: false, reason: 'relay-discovery-min-score-too-low' };
    }
  }

  if (policy.maxResults !== undefined) {
    if (
      snapshot.options.maxResults === undefined ||
      snapshot.options.maxResults > policy.maxResults
    ) {
      return { eligible: false, reason: 'relay-discovery-max-results-too-high' };
    }
  }

  if (snapshot.options.minScore !== undefined) {
    const hasLowScore = snapshot.relays.some((relay) => relay.score < snapshot.options.minScore!);
    if (hasLowScore) {
      return { eligible: false, reason: 'relay-discovery-score-mismatch' };
    }
  }

  if (
    snapshot.options.maxResults !== undefined &&
    snapshot.relays.length > snapshot.options.maxResults
  ) {
    return { eligible: false, reason: 'relay-discovery-exceeds-max-results' };
  }

  return { eligible: true };
};

export const markNodeFailure = (service: RouterService, nodeId: string): void => {
  const entry = getNodeHealth(service, nodeId);
  entry.failures += 1;
  entry.consecutiveFailures += 1;
  entry.lastFailureMs = Date.now();
  nodeFailureEvents.inc({ nodeId });
  if (entry.consecutiveFailures >= NODE_FAILURE_THRESHOLD) {
    const multiplier = Math.min(
      NODE_FAILURE_BACKOFF_CAP,
      entry.consecutiveFailures - NODE_FAILURE_THRESHOLD + 1,
    );
    service.nodeCooldown.set(nodeId, Date.now() + NODE_FAILURE_BASE_COOLDOWN_MS * multiplier);
  }
};

export const recordNodeSuccess = (service: RouterService, nodeId: string): void => {
  const entry = getNodeHealth(service, nodeId);
  entry.successes += 1;
  entry.consecutiveFailures = 0;
  entry.lastSuccessMs = Date.now();
  service.nodeCooldown.delete(nodeId);
};

export const failurePenalty = (service: RouterService, nodeId: string): number => {
  const entry = service.nodeHealth.get(nodeId);
  if (!entry) {
    return 0;
  }
  const total = entry.successes + entry.failures;
  const reliabilityPenalty =
    total >= NODE_RELIABILITY_SAMPLE_MIN
      ? Math.min(
          NODE_RELIABILITY_MAX_PENALTY,
          Math.round((entry.failures / total) * NODE_RELIABILITY_MAX_PENALTY),
        )
      : 0;
  const streakPenalty = Math.min(20, entry.consecutiveFailures * 5);
  return Math.min(30, reliabilityPenalty + streakPenalty);
};

export const performanceBonus = (service: RouterService, nodeId: string): number => {
  const entry = service.nodeHealth.get(nodeId);
  if (!entry) {
    return 0;
  }
  const total = entry.successes + entry.failures;
  if (total < NODE_PERFORMANCE_SAMPLE_MIN) {
    return 0;
  }
  const successRate = entry.successes / total;
  const rawBonus = Math.round((successRate - NODE_PERFORMANCE_BASELINE) * 100);
  return Math.max(-NODE_PERFORMANCE_MAX_BONUS, Math.min(NODE_PERFORMANCE_MAX_BONUS, rawBonus));
};

export const manifestDecayFactor = (service: RouterService, nodeId: string): number => {
  const entry = service.nodeHealth.get(nodeId);
  if (!entry) {
    return 1;
  }
  const total = entry.successes + entry.failures;
  if (total <= 0) {
    return 1;
  }
  const factor = 1 - Math.min(1, total / MANIFEST_DECAY_SAMPLES);
  return Math.max(0, factor);
};

export const filterActiveNodes = (service: RouterService, nodes: NodeDescriptor[]): NodeDescriptor[] => {
  const cutoff = Date.now() - NODE_HEARTBEAT_WINDOW_MS;
  return nodes.filter((node) => {
    if (node.lastHeartbeatMs && node.lastHeartbeatMs < cutoff) {
      return false;
    }
    const cooldown = service.nodeCooldown.get(node.nodeId);
    return !cooldown || cooldown <= Date.now();
  });
};

export const manifestScore = (manifest?: NodeManifest): number => {
  if (!manifest) {
    return 0;
  }

  let score = 0;
  switch (manifest.capability_bands.cpu) {
    case 'cpu_high':
      score += 30;
      break;
    case 'cpu_mid':
      score += 15;
      break;
    default:
      break;
  }
  switch (manifest.capability_bands.ram) {
    case 'ram_64_plus':
      score += 25;
      break;
    case 'ram_32':
      score += 15;
      break;
    case 'ram_16':
      score += 5;
      break;
    default:
      break;
  }
  if (manifest.capability_bands.disk === 'disk_ssd') {
    score += 10;
  }
  if (manifest.capability_bands.net === 'net_good') {
    score += 10;
  }
  switch (manifest.capability_bands.gpu) {
    case 'gpu_24gb_plus':
      score += 20;
      break;
    case 'gpu_16gb':
      score += 10;
      break;
    case 'gpu_8gb':
      score += 5;
      break;
    default:
      break;
  }

  return Math.min(score, 100);
};

export const stakeScore = (service: RouterService, nodeId: string): number => {
  const units = effectiveStakeUnits(service.stakeStore, nodeId);
  const score = units / 100;
  return Math.min(20, score);
};