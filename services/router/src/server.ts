import type {
  Envelope,
  InferenceRequest,
  InferenceResponse,
  NodeDescriptor,
  PaymentReceipt,
  PaymentRequest,
} from '@fed-ai/protocol';
import {
  createStakeStore,
  StakeStore,
} from './accounting/staking';
import type { RouterConfig } from './config';
import { selectNode } from './scheduler';
import type { RouterStore, RouterStoreSnapshot } from './storage/types';
import type { NodeManifest } from '@fed-ai/manifest';

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
  weightedNodesCache?: { computedAtMs: number; nodes: NodeDescriptor[] };
  store?: RouterStore;
  federation: {
    capabilities: import('@fed-ai/protocol').RouterCapabilityProfile | null;
    priceSheets: Map<string, import('@fed-ai/protocol').RouterPriceSheet>;
    status: import('@fed-ai/protocol').RouterStatusPayload | null;
    bids: Map<string, import('@fed-ai/protocol').RouterBidPayload>;
    awards: Map<string, import('@fed-ai/protocol').RouterControlMessage<import('@fed-ai/protocol').RouterAwardPayload>>;
    outboundAwards: Map<
      string,
      import('@fed-ai/protocol').RouterControlMessage<import('@fed-ai/protocol').RouterAwardPayload>
    >;
    localCapabilities: import('@fed-ai/protocol').RouterCapabilityProfile | null;
    localPriceSheets: Map<string, import('@fed-ai/protocol').RouterPriceSheet>;
    localStatus: import('@fed-ai/protocol').RouterStatusPayload | null;
    jobs: Map<
      string,
      {
        submit: import('@fed-ai/protocol').RouterJobSubmit;
        requestRouterId: string;
        result?: import('@fed-ai/protocol').RouterJobResult;
        settlement?: {
          receipt?: import('@fed-ai/protocol').RouterReceipt;
          paymentRequest?: import('@fed-ai/protocol').PaymentRequest;
          paymentReceipt?: Envelope<import('@fed-ai/protocol').PaymentReceipt>;
        };
      }
    >;
    outboundJobs: Map<
      string,
      {
        submit: import('@fed-ai/protocol').RouterJobSubmit;
        award: import('@fed-ai/protocol').RouterControlMessage<import('@fed-ai/protocol').RouterAwardPayload>;
        peer: string;
        result?: import('@fed-ai/protocol').RouterJobResult;
        settlement?: {
          receipt?: import('@fed-ai/protocol').RouterReceipt;
          paymentRequest?: import('@fed-ai/protocol').PaymentRequest;
          paymentReceipt?: Envelope<import('@fed-ai/protocol').PaymentReceipt>;
        };
      }
    >;
  };
};

export const createRouterService = (config: RouterConfig, store?: RouterStore): RouterService => {
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
    store,
    federation: {
      capabilities: null,
      priceSheets: new Map(),
      status: null,
      bids: new Map(),
      awards: new Map(),
      outboundAwards: new Map(),
      localCapabilities: null,
      localPriceSheets: new Map(),
      localStatus: null,
      jobs: new Map(),
      outboundJobs: new Map(),
    },
  };
};

export const hydrateRouterService = (service: RouterService, snapshot: RouterStoreSnapshot): void => {
  service.nodes = snapshot.nodes;
  service.paymentRequests = new Map(snapshot.paymentRequests.map((entry) => [entry.key, entry.request]));
  service.paymentReceipts = new Map(snapshot.paymentReceipts.map((entry) => [entry.key, entry.receipt]));
  service.manifests = new Map(snapshot.manifests.map((manifest) => [manifest.id, manifest]));
  service.manifestAdmissions = new Map(
    snapshot.manifestAdmissions.map((entry) => [
      entry.nodeId,
      { eligible: entry.eligible, reason: entry.reason },
    ]),
  );
};

export const registerNode = async (service: RouterService, node: NodeDescriptor): Promise<void> => {
  service.nodes = service.nodes.filter((existing) => existing.nodeId !== node.nodeId);
  service.nodes.push(node);
  if (service.store) {
    await service.store.saveNode(node);
  }
};

export const recordPaymentRequest = async (
  service: RouterService,
  key: string,
  request: PaymentRequest,
): Promise<void> => {
  service.paymentRequests.set(key, request);
  if (service.store) {
    await service.store.savePaymentRequest(key, request);
  }
};

export const recordPaymentReceipt = async (
  service: RouterService,
  key: string,
  receipt: Envelope<PaymentReceipt>,
): Promise<void> => {
  service.paymentReceipts.set(key, receipt);
  if (service.store) {
    await service.store.savePaymentReceipt(key, receipt);
  }
};

export const recordManifest = async (
  service: RouterService,
  manifest: NodeManifest,
): Promise<void> => {
  service.manifests.set(manifest.id, manifest);
  if (service.store) {
    await service.store.saveManifest(manifest);
  }
};

export const recordManifestAdmission = async (
  service: RouterService,
  nodeId: string,
  admission: { eligible: boolean; reason?: string },
): Promise<void> => {
  service.manifestAdmissions.set(nodeId, admission);
  if (service.store) {
    await service.store.saveManifestAdmission(nodeId, admission);
  }
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
      jobType: request.jobType,
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
