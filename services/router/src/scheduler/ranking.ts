import type { RouterService } from '../server';
import type { NodeDescriptor, Capability, QuoteRequest } from '@fed-ai/protocol';
import { scoreNode, estimatePrice } from './score';
import { manifestScore, manifestDecayFactor, stakeScore, failurePenalty, performanceBonus } from './health';

export const applyManifestWeights = (service: RouterService): NodeDescriptor[] => {
  return service.nodes.map((node) => {
    const manifest = service.manifests.get(node.nodeId);
    const admission = service.manifestAdmissions.get(node.nodeId);
    const baseTrust = node.trustScore ?? 0;
    const manifestTrust =
      manifest && (!admission || admission.eligible)
        ? Math.round(manifestScore(manifest) * manifestDecayFactor(service, node.nodeId))
        : 0;
    const stakeTrust = stakeScore(service, node.nodeId);
    const penalty = failurePenalty(service, node.nodeId);
    const performance = performanceBonus(service, node.nodeId);
    return {
      ...node,
      trustScore: Math.max(
        0,
        Math.min(100, baseTrust + manifestTrust + stakeTrust + performance - penalty),
      ),
    };
  });
};

export const getWeightedNodes = (service: RouterService): NodeDescriptor[] => {
  const nowMs = Date.now();
  const cache = service.weightedNodesCache;
  if (cache && nowMs - cache.computedAtMs < 1000) {
    return cache.nodes;
  }
  const weighted = applyManifestWeights(service);
  service.weightedNodesCache = { computedAtMs: nowMs, nodes: weighted };
  return weighted;
};

export const rankCandidateNodes = (
  nodes: NodeDescriptor[],
  request: QuoteRequest,
  topK: number | undefined,
): NodeDescriptor[] => {
  const limit = topK && topK > 0 ? topK : nodes.length;
  const ranked: Array<{ node: NodeDescriptor; score: number }> = [];
  for (const node of nodes) {
    const score = scoreNode(node, request);
    if (score === null) {
      continue;
    }
    let inserted = false;
    for (let i = 0; i < ranked.length; i += 1) {
      if (score > ranked[i].score) {
        ranked.splice(i, 0, { node, score });
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      ranked.push({ node, score });
    }
    if (ranked.length > limit) {
      ranked.length = limit;
    }
  }
  return ranked.map((entry) => entry.node);
};

export const pickCapabilityForRequest = (
  node: NodeDescriptor,
  request: QuoteRequest,
): Capability | null => {
  if (!node.capabilities || node.capabilities.length === 0) {
    return null;
  }
  const requiredTokens = request.inputTokensEstimate + request.outputTokensEstimate;
  const matchesJobType = (capability: Capability): boolean => {
    if (!request.jobType) {
      return true;
    }
    if (!capability.jobTypes || capability.jobTypes.length === 0) {
      return false;
    }
    return capability.jobTypes.includes(request.jobType);
  };
  const fitsContextWindow = (capability: Capability): boolean => {
    if (!capability.contextWindow) {
      return true;
    }
    return requiredTokens <= capability.contextWindow;
  };
  if (request.modelId !== 'auto') {
    return (
      node.capabilities.find(
        (capability) =>
          capability.modelId === request.modelId &&
          matchesJobType(capability) &&
          fitsContextWindow(capability),
      ) ?? null
    );
  }
  let best: { cap: Capability; price: number } | null = null;
  for (const capability of node.capabilities) {
    if (!matchesJobType(capability) || !fitsContextWindow(capability)) {
      continue;
    }
    const price = estimatePrice(capability, request);
    if (!best || price < best.price) {
      best = { cap: capability, price };
    }
  }
  return best?.cap ?? null;
};
