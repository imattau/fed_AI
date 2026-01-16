import type { Envelope, InferenceRequest, InferenceResponse, NodeDescriptor } from '@fed-ai/protocol';
import { createStakeStore, StakeStore } from './accounting/staking';
import type { RouterConfig } from './config';
import { selectNode } from './scheduler';

export type RouterService = {
  config: RouterConfig;
  nodes: NodeDescriptor[];
  paymentReceipts: Map<string, Envelope<import('@fed-ai/protocol').PaymentReceipt>>;
  manifests: Map<string, import('@fed-ai/manifest').NodeManifest>;
  stakeStore: StakeStore;
};

export const createRouterService = (config: RouterConfig): RouterService => {
  return {
    config,
    nodes: [],
    paymentReceipts: new Map(),
    manifests: new Map(),
    stakeStore: createStakeStore(),
  };
};

export const registerNode = (service: RouterService, node: NodeDescriptor): void => {
  service.nodes = service.nodes.filter((existing) => existing.nodeId !== node.nodeId);
  service.nodes.push(node);
};

export const selectNodeForRequest = (service: RouterService, request: InferenceRequest): NodeDescriptor | null => {
  const selection = selectNode({
    nodes: service.nodes,
    request: {
      requestId: request.requestId,
      modelId: request.modelId,
      maxTokens: request.maxTokens,
      inputTokensEstimate: request.prompt.length,
      outputTokensEstimate: request.maxTokens,
    },
  });

  return selection.selected ?? null;
};

export const handleInference = (
  _service: RouterService,
  _request: Envelope<InferenceRequest>,
): Promise<Envelope<InferenceResponse>> => {
  return Promise.reject(new Error('Router inference forwarding not implemented yet.'));
};
