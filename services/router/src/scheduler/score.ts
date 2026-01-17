import type { Capability, NodeDescriptor, QuoteRequest } from '@fed-ai/protocol';

const matchesJobType = (capability: Capability, request: QuoteRequest): boolean => {
  if (!request.jobType) {
    return true;
  }
  if (!capability.jobTypes || capability.jobTypes.length === 0) {
    return false;
  }
  return capability.jobTypes.includes(request.jobType);
};

const findCapability = (node: NodeDescriptor, request: QuoteRequest): Capability | undefined => {
  return node.capabilities.find(
    (capability) =>
      capability.modelId === request.modelId && matchesJobType(capability, request),
  );
};

const pickCheapestCapability = (node: NodeDescriptor, request: QuoteRequest): Capability | undefined => {
  let best: { cap: Capability; price: number } | null = null;
  for (const capability of node.capabilities) {
    if (!matchesJobType(capability, request)) {
      continue;
    }
    const price = estimatePrice(capability, request);
    if (!best || price < best.price) {
      best = { cap: capability, price };
    }
  }
  return best?.cap;
};

export const estimatePrice = (capability: Capability, request: QuoteRequest): number => {
  const inputCost = capability.pricing.inputRate * request.inputTokensEstimate;
  const outputCost = capability.pricing.outputRate * request.outputTokensEstimate;
  return inputCost + outputCost;
};

export const scoreNode = (node: NodeDescriptor, request: QuoteRequest): number | null => {
  const capability =
    request.modelId === 'auto'
      ? pickCheapestCapability(node, request)
      : findCapability(node, request);
  if (!capability) {
    return null;
  }

  const price = estimatePrice(capability, request);
  const loadFactor = node.capacity.maxConcurrent > 0 ? node.capacity.currentLoad / node.capacity.maxConcurrent : 1;
  const trust = node.trustScore ?? 0;
  const latencyPenalty = (capability.latencyEstimateMs ?? 0) / 1000;

  // Lower price/load/latency should score higher; trust adds a small bonus.
  return -price - loadFactor - latencyPenalty + trust * 0.01;
};
