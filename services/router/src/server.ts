import type { Envelope, InferenceRequest, InferenceResponse, NodeDescriptor } from '@fed-ai/protocol';
import {
  createStakeStore,
  StakeStore,
} from './accounting/staking';
import type { RouterConfig } from './config';
import { selectNode } from './scheduler';

export type RouterService = {
  config: RouterConfig;
  nodes: NodeDescriptor[];
  paymentReceipts: Map<string, Envelope<import('@fed-ai/protocol').PaymentReceipt>>;
  paymentRequests: Map<string, import('@fed-ai/protocol').PaymentRequest>;
  federationPaymentRequests: Map<string, import('@fed-ai/protocol').PaymentRequest>;
  federationPaymentReceipts: Map<string, Envelope<import('@fed-ai/protocol').PaymentReceipt>>;
  manifests: Map<string, import('@fed-ai/manifest').NodeManifest>;
  manifestAdmissions: Map<string, { eligible: boolean; reason?: string }>;
  stakeStore: StakeStore;
  nodeCooldown: Map<string, number>;
  nodeHealth: Map<
    string,
    {
      successes: number;
      failures: number;
      consecutiveFailures: number;
      lastFailureMs: number;
      lastSuccessMs: number;
    }
  >;
  federation: {
    capabilities: import('@fed-ai/protocol').RouterCapabilityProfile | null;
    priceSheets: Map<string, import('@fed-ai/protocol').RouterPriceSheet>;
    status: import('@fed-ai/protocol').RouterStatusPayload | null;
    bids: Map<string, import('@fed-ai/protocol').RouterBidPayload>;
    awards: Map<string, import('@fed-ai/protocol').RouterAwardPayload>;
    localCapabilities: import('@fed-ai/protocol').RouterCapabilityProfile | null;
    localPriceSheets: Map<string, import('@fed-ai/protocol').RouterPriceSheet>;
    localStatus: import('@fed-ai/protocol').RouterStatusPayload | null;
    jobs: Map<
      string,
      {
        submit: import('@fed-ai/protocol').RouterJobSubmit;
        result?: import('@fed-ai/protocol').RouterJobResult;
        settlement?: {
          paymentRequest?: import('@fed-ai/protocol').PaymentRequest;
          paymentReceipt?: Envelope<import('@fed-ai/protocol').PaymentReceipt>;
        };
      }
    >;
  };
};

export const createRouterService = (config: RouterConfig): RouterService => {
  return {
    config,
    nodes: [],
    paymentReceipts: new Map(),
    paymentRequests: new Map(),
    federationPaymentRequests: new Map(),
    federationPaymentReceipts: new Map(),
    manifests: new Map(),
    manifestAdmissions: new Map(),
    stakeStore: createStakeStore(),
    nodeCooldown: new Map(),
    nodeHealth: new Map(),
    federation: {
      capabilities: null,
      priceSheets: new Map(),
      status: null,
      bids: new Map(),
      awards: new Map(),
      localCapabilities: null,
      localPriceSheets: new Map(),
      localStatus: null,
      jobs: new Map(),
    },
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
