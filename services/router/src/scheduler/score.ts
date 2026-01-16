import type { Capability, NodeDescriptor, QuoteRequest } from '@fed-ai/protocol';

const findCapability = (node: NodeDescriptor, modelId: string): Capability | undefined => {
  return node.capabilities.find((capability) => capability.modelId === modelId);
};

export const estimatePrice = (capability: Capability, request: QuoteRequest): number => {
  const inputCost = capability.pricing.inputRate * request.inputTokensEstimate;
  const outputCost = capability.pricing.outputRate * request.outputTokensEstimate;
  return inputCost + outputCost;
};

export const scoreNode = (node: NodeDescriptor, request: QuoteRequest): number | null => {
  const capability = findCapability(node, request.modelId);
  if (!capability) {
    return null;
  }

  const price = estimatePrice(capability, request);
  const loadFactor = node.capacity.maxConcurrent > 0 ? node.capacity.currentLoad / node.capacity.maxConcurrent : 1;
  const trust = node.trustScore ?? 0;

  // Lower price and lower load should score higher; trust adds a small bonus.
  return -price - loadFactor + trust * 0.01;
};
