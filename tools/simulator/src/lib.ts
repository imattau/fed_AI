import { selectNode } from '@fed-ai/router';
import type { NodeDescriptor, QuoteRequest } from '@fed-ai/protocol';

export type SimulationConfig = {
  nodes: number;
  requests: number;
  seed: number;
};

export type EndToEndConfig = SimulationConfig & {
  routers: number;
  nodesPerRouter: number;
  federationEnabled: boolean;
  auctionEnabled: boolean;
  auctionTimeoutMs: number;
  bidVariance: number;
  paymentFlow: PaymentFlowVariant;
  maxOffloads: number;
  offloadThreshold: number;
  nodeFailureRate: number;
  paymentFailureRate: number;
  receiptFailureRate: number;
};

export type SimulationMetrics = {
  totalRequests: number;
  servedRequests: number;
  droppedRequests: number;
  dropRate: number;
  costPerRequestAvg: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  nodeUtilization: Record<string, number>;
};

export type EndToEndMetrics = SimulationMetrics & {
  avgLatencyMs: number;
  federation: {
    attempts: number;
    success: number;
    failed: number;
    bids: number;
    awards: number;
    auctionFailures: number;
  };
  payment: {
    flow: PaymentFlowVariant;
    challenges: number;
    failures: number;
    receiptFailures: number;
    receiptsPerRequest: number;
  };
  drops: {
    noCapacity: number;
    nodeFailure: number;
    paymentFailure: number;
    receiptFailure: number;
    federationFailure: number;
  };
};

export type EndToEndReport = {
  baseConfig: EndToEndConfig;
  metrics: EndToEndMetrics;
};

export type PricingSensitivityResult = {
  multiplier: number;
  metrics: SimulationMetrics;
};

export type PricingSensitivityReport = {
  baseConfig: SimulationConfig;
  results: PricingSensitivityResult[];
};

export type PaymentFlowVariant = 'pay-before' | 'pay-after';

export type PaymentFlowMetrics = SimulationMetrics & {
  flow: PaymentFlowVariant;
  receiptsPerRequest: number;
  extraLatencyMs: number;
};

export type PaymentFlowReport = {
  baseConfig: SimulationConfig;
  flows: PaymentFlowMetrics[];
};

const DEFAULT_MAX_TOKENS = 256;

export const createRng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };
};

const pick = <T>(rng: () => number, values: T[]): T => {
  return values[Math.floor(rng() * values.length)];
};

export const generateNodes = (count: number, rng: () => number): NodeDescriptor[] => {
  const nodes: NodeDescriptor[] = [];
  for (let i = 0; i < count; i += 1) {
    const nodeId = `node-${i + 1}`;
    const baseRate = 0.001 + rng() * 0.01;
    const maxConcurrent = 5 + Math.floor(rng() * 20);

    nodes.push({
      nodeId,
      keyId: `${nodeId}-key`,
      endpoint: `http://${nodeId}.local`,
      capacity: {
        maxConcurrent,
        currentLoad: Math.floor(rng() * maxConcurrent),
      },
      capabilities: [
        {
          modelId: 'mock-model',
          contextWindow: 4096,
          maxTokens: 1024,
          pricing: {
            unit: 'token',
            inputRate: baseRate,
            outputRate: baseRate * 1.2,
            currency: 'USD',
          },
        },
      ],
      trustScore: Math.floor(rng() * 100),
    });
  }
  return nodes;
};

export const generateNodesWithPrefix = (
  count: number,
  rng: () => number,
  prefix: string,
  offset = 0,
): NodeDescriptor[] => {
  const nodes: NodeDescriptor[] = [];
  for (let i = 0; i < count; i += 1) {
    const nodeId = `${prefix}-${offset + i + 1}`;
    const baseRate = 0.001 + rng() * 0.01;
    const maxConcurrent = 5 + Math.floor(rng() * 20);

    nodes.push({
      nodeId,
      keyId: `${nodeId}-key`,
      endpoint: `http://${nodeId}.local`,
      capacity: {
        maxConcurrent,
        currentLoad: Math.floor(rng() * maxConcurrent),
      },
      capabilities: [
        {
          modelId: 'mock-model',
          contextWindow: 4096,
          maxTokens: 1024,
          pricing: {
            unit: 'token',
            inputRate: baseRate,
            outputRate: baseRate * 1.2,
            currency: 'USD',
          },
        },
      ],
      trustScore: Math.floor(rng() * 100),
    });
  }
  return nodes;
};

export const generateRequests = (count: number, rng: () => number): QuoteRequest[] => {
  const requests: QuoteRequest[] = [];
  for (let i = 0; i < count; i += 1) {
    const inputTokensEstimate = 10 + Math.floor(rng() * 200);
    const outputTokensEstimate = 10 + Math.floor(rng() * 200);

    requests.push({
      requestId: `req-${i + 1}`,
      modelId: 'mock-model',
      maxTokens: DEFAULT_MAX_TOKENS,
      inputTokensEstimate,
      outputTokensEstimate,
    });
  }
  return requests;
};

const estimateCost = (node: NodeDescriptor, request: QuoteRequest): number => {
  const capability = node.capabilities.find((item) => item.modelId === request.modelId);
  if (!capability) {
    return 0;
  }
  return (
    capability.pricing.inputRate * request.inputTokensEstimate +
    capability.pricing.outputRate * request.outputTokensEstimate
  );
};

const estimateLatency = (node: NodeDescriptor, rng: () => number): number => {
  const loadFactor =
    node.capacity.maxConcurrent > 0 ? node.capacity.currentLoad / node.capacity.maxConcurrent : 1;
  return Math.round(40 + loadFactor * 120 + rng() * 25);
};

const avgLatency = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const percentile = (values: number[], percentileValue: number): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * percentileValue));
  return sorted[index];
};

const runSimulationWith = (
  nodes: NodeDescriptor[],
  requests: QuoteRequest[],
  rng: () => number,
): SimulationMetrics => {
  const latencies: number[] = [];
  let served = 0;
  let totalCost = 0;
  const assignedCounts: Record<string, number> = {};

  for (const request of requests) {
    const selection = selectNode({ nodes, request });
    if (!selection.selected) {
      continue;
    }

    served += 1;
    assignedCounts[selection.selected.nodeId] =
      (assignedCounts[selection.selected.nodeId] ?? 0) + 1;
    totalCost += estimateCost(selection.selected, request);
    latencies.push(estimateLatency(selection.selected, rng));
  }

  const utilization: Record<string, number> = {};
  nodes.forEach((node) => {
    const assigned = assignedCounts[node.nodeId] ?? 0;
    utilization[node.nodeId] = node.capacity.maxConcurrent
      ? assigned / node.capacity.maxConcurrent
      : 0;
  });

  const dropRate = requests.length === 0 ? 0 : (requests.length - served) / requests.length;

  return {
    totalRequests: requests.length,
    servedRequests: served,
    droppedRequests: requests.length - served,
    dropRate,
    costPerRequestAvg: served === 0 ? 0 : totalCost / served,
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    nodeUtilization: utilization,
  };
};

const applyPricingMultiplier = (nodes: NodeDescriptor[], multiplier: number): NodeDescriptor[] => {
  return nodes.map((node) => ({
    ...node,
    capabilities: node.capabilities.map((capability) => ({
      ...capability,
      pricing: {
        ...capability.pricing,
        inputRate: capability.pricing.inputRate * multiplier,
        outputRate: capability.pricing.outputRate * multiplier,
      },
    })),
  }));
};

export const runSimulation = (config: SimulationConfig): SimulationMetrics => {
  const rng = createRng(config.seed);
  const nodes = generateNodes(config.nodes, rng);
  const requests = generateRequests(config.requests, rng);
  return runSimulationWith(nodes, requests, rng);
};

export const runPricingSensitivity = (
  config: SimulationConfig,
  multipliers: number[],
): PricingSensitivityReport => {
  const baseRng = createRng(config.seed);
  const baseNodes = generateNodes(config.nodes, baseRng);
  const baseRequests = generateRequests(config.requests, baseRng);

  const results = multipliers.map((multiplier, index) => {
    const nodes = applyPricingMultiplier(baseNodes, multiplier);
    const rng = createRng(config.seed + index + 1);
    return {
      multiplier,
      metrics: runSimulationWith(nodes, baseRequests, rng),
    };
  });

  return {
    baseConfig: config,
    results,
  };
};

export const formatMarkdownSummary = (metrics: SimulationMetrics): string => {
  return `# Simulation Summary\n\n` +
    `- Total requests: ${metrics.totalRequests}\n` +
    `- Served requests: ${metrics.servedRequests}\n` +
    `- Dropped requests: ${metrics.droppedRequests}\n` +
    `- Drop rate: ${(metrics.dropRate * 100).toFixed(2)}%\n` +
    `- Avg cost per request: ${metrics.costPerRequestAvg.toFixed(6)}\n` +
    `- p50 latency (ms): ${metrics.p50LatencyMs}\n` +
    `- p95 latency (ms): ${metrics.p95LatencyMs}\n`;
};

export const formatPricingSummary = (report: PricingSensitivityReport): string => {
  const lines = ['# Pricing Sensitivity Summary', ''];
  for (const result of report.results) {
    lines.push(
      `- x${result.multiplier}: avg cost ${result.metrics.costPerRequestAvg.toFixed(6)}, drop ${(result.metrics.dropRate * 100).toFixed(2)}%`,
    );
  }
  return lines.join('\n');
};

const paymentFlowConfig = {
  'pay-before': {
    receipts: 1,
    latencyDelta: 12,
    dropPenalty: 0,
    costMultiplier: 1,
  },
  'pay-after': {
    receipts: 2,
    latencyDelta: 48,
    dropPenalty: 0.04,
    costMultiplier: 1.08,
  },
} as const;

const federationOverheadMs = {
  controlPlane: 15,
  dataPlane: 35,
} as const;

type RouterSim = {
  id: string;
  nodes: NodeDescriptor[];
  maxOffloads: number;
  activeOffloads: number;
  pricePerToken: number;
};

const computeRouterLoad = (router: RouterSim): number => {
  const totals = router.nodes.reduce(
    (acc, node) => {
      acc.capacity += node.capacity.maxConcurrent;
      acc.load += node.capacity.currentLoad;
      return acc;
    },
    { capacity: 0, load: 0 },
  );
  return totals.capacity > 0 ? totals.load / totals.capacity : 1;
};

const selectPeerRouter = (router: RouterSim, peers: RouterSim[], rng: () => number): RouterSim | null => {
  const candidates = peers.filter((peer) => peer.id !== router.id && peer.activeOffloads < peer.maxOffloads);
  if (candidates.length === 0) {
    return null;
  }
  const scored = candidates
    .map((peer) => {
      const load = computeRouterLoad(peer);
      return { peer, score: peer.pricePerToken + load * 0.1 + rng() * 0.01 };
    })
    .sort((a, b) => a.score - b.score);
  return scored[0].peer;
};

const runAuction = (
  router: RouterSim,
  peers: RouterSim[],
  rng: () => number,
  bidVariance: number,
): { winner: RouterSim | null; bids: number } => {
  const candidates = peers.filter((peer) => peer.id !== router.id && peer.activeOffloads < peer.maxOffloads);
  if (candidates.length === 0) {
    return { winner: null, bids: 0 };
  }
  const bids = candidates.map((peer) => {
    const load = computeRouterLoad(peer);
    const noise = (rng() - 0.5) * bidVariance;
    const bid = peer.pricePerToken + load * 0.1 + noise;
    return { peer, bid };
  });
  bids.sort((a, b) => a.bid - b.bid);
  return { winner: bids[0].peer, bids: bids.length };
};

export const buildEndToEndConfig = (
  config: SimulationConfig,
  overrides: Partial<EndToEndConfig> = {},
): EndToEndConfig => ({
  ...config,
  routers: 3,
  nodesPerRouter: Math.max(1, Math.floor(config.nodes / 3)),
  federationEnabled: true,
  auctionEnabled: false,
  auctionTimeoutMs: 500,
  bidVariance: 0.02,
  paymentFlow: 'pay-before',
  maxOffloads: 5,
  offloadThreshold: 0.75,
  nodeFailureRate: 0.03,
  paymentFailureRate: 0.02,
  receiptFailureRate: 0.01,
  ...overrides,
});

const adjustMetricsForFlow = (
  base: SimulationMetrics,
  config: SimulationConfig,
  variant: PaymentFlowVariant,
): PaymentFlowMetrics => {
  const adjustment = paymentFlowConfig[variant];
  const extraDrops = Math.min(config.requests, Math.round(adjustment.dropPenalty * config.requests));
  const servedRequests = Math.max(0, base.servedRequests - extraDrops);
  const droppedRequests = config.requests - servedRequests;
  const dropRate = config.requests === 0 ? 0 : droppedRequests / config.requests;

  const costPerRequestAvg =
    servedRequests === 0
      ? 0
      : base.costPerRequestAvg * adjustment.costMultiplier;

  const p50LatencyMs = base.p50LatencyMs + adjustment.latencyDelta;
  const p95LatencyMs = base.p95LatencyMs + adjustment.latencyDelta * 1.2;

  return {
    ...base,
    flow: variant,
    receiptsPerRequest: adjustment.receipts,
    extraLatencyMs: adjustment.latencyDelta,
    servedRequests,
    droppedRequests,
    dropRate,
    costPerRequestAvg,
    p50LatencyMs,
    p95LatencyMs,
  };
};

export const runPaymentFlowScenario = (config: SimulationConfig): PaymentFlowReport => {
  const metrics = runSimulation(config);
  const flows: PaymentFlowMetrics[] = (['pay-before', 'pay-after'] as PaymentFlowVariant[]).map((variant) =>
    adjustMetricsForFlow(metrics, config, variant),
  );
  return {
    baseConfig: config,
    flows,
  };
};

export const runEndToEndSimulation = (config: EndToEndConfig): EndToEndReport => {
  const rng = createRng(config.seed);
  const requests = generateRequests(config.requests, rng);

  const routers: RouterSim[] = [];
  for (let i = 0; i < config.routers; i += 1) {
    const routerId = `router-${i + 1}`;
    const nodes = generateNodesWithPrefix(config.nodesPerRouter, rng, `${routerId}-node`);
    const avgPrice =
      nodes.reduce((sum, node) => sum + (node.capabilities[0]?.pricing.inputRate ?? 0), 0) /
      Math.max(1, nodes.length);
    routers.push({
      id: routerId,
      nodes,
      maxOffloads: config.maxOffloads,
      activeOffloads: 0,
      pricePerToken: avgPrice,
    });
  }

  const latencies: number[] = [];
  let served = 0;
  let totalCost = 0;
  const assignedCounts: Record<string, number> = {};
  const drops = {
    noCapacity: 0,
    nodeFailure: 0,
    paymentFailure: 0,
    receiptFailure: 0,
    federationFailure: 0,
  };
  const federation = {
    attempts: 0,
    success: 0,
    failed: 0,
    bids: 0,
    awards: 0,
    auctionFailures: 0,
  };
  const payment = {
    flow: config.paymentFlow,
    challenges: 0,
    failures: 0,
    receiptFailures: 0,
    receiptsPerRequest: paymentFlowConfig[config.paymentFlow].receipts,
  };

  for (const request of requests) {
    const ingressRouter = pick(rng, routers);
    const load = computeRouterLoad(ingressRouter);
    const shouldOffload = config.federationEnabled && load >= config.offloadThreshold;

    let targetRouter = ingressRouter;
    let offloaded = false;
    if (shouldOffload) {
      federation.attempts += 1;
      let peer: RouterSim | null = null;
      if (config.auctionEnabled) {
        const auction = runAuction(ingressRouter, routers, rng, config.bidVariance);
        federation.bids += auction.bids;
        peer = auction.winner;
        if (!peer) {
          federation.failed += 1;
          federation.auctionFailures += 1;
          drops.federationFailure += 1;
          continue;
        }
        federation.awards += 1;
      } else {
        peer = selectPeerRouter(ingressRouter, routers, rng);
      }
      if (!peer) {
        federation.failed += 1;
        drops.federationFailure += 1;
        continue;
      }
      peer.activeOffloads += 1;
      targetRouter = peer;
      offloaded = true;
    }

    const selection = selectNode({ nodes: targetRouter.nodes, request });
    if (!selection.selected) {
      drops.noCapacity += 1;
      if (offloaded) {
        federation.failed += 1;
        targetRouter.activeOffloads = Math.max(0, targetRouter.activeOffloads - 1);
      }
      continue;
    }

    const node = selection.selected;
    node.capacity.currentLoad += 1;

    if (rng() < config.nodeFailureRate) {
      drops.nodeFailure += 1;
      node.capacity.currentLoad = Math.max(0, node.capacity.currentLoad - 1);
      if (offloaded) {
        targetRouter.activeOffloads = Math.max(0, targetRouter.activeOffloads - 1);
      }
      continue;
    }

    payment.challenges += 1;
    if (rng() < config.paymentFailureRate) {
      payment.failures += 1;
      drops.paymentFailure += 1;
      node.capacity.currentLoad = Math.max(0, node.capacity.currentLoad - 1);
      if (offloaded) {
        targetRouter.activeOffloads = Math.max(0, targetRouter.activeOffloads - 1);
      }
      continue;
    }

    if (rng() < config.receiptFailureRate) {
      payment.receiptFailures += 1;
      drops.receiptFailure += 1;
      node.capacity.currentLoad = Math.max(0, node.capacity.currentLoad - 1);
      if (offloaded) {
        targetRouter.activeOffloads = Math.max(0, targetRouter.activeOffloads - 1);
      }
      continue;
    }

    const baseLatency = estimateLatency(node, rng);
    const paymentLatency = paymentFlowConfig[config.paymentFlow].latencyDelta;
    const federationLatency =
      shouldOffload && targetRouter.id !== ingressRouter.id
        ? federationOverheadMs.controlPlane +
          federationOverheadMs.dataPlane +
          (config.auctionEnabled ? config.auctionTimeoutMs : 0)
        : 0;
    const latency = baseLatency + paymentLatency + federationLatency;

    served += 1;
    assignedCounts[node.nodeId] = (assignedCounts[node.nodeId] ?? 0) + 1;
    totalCost += estimateCost(node, request);
    latencies.push(latency);
    node.capacity.currentLoad = Math.max(0, node.capacity.currentLoad - 1);

    if (offloaded && targetRouter.id !== ingressRouter.id) {
      federation.success += 1;
      targetRouter.activeOffloads = Math.max(0, targetRouter.activeOffloads - 1);
    }
  }

  const utilization: Record<string, number> = {};
  routers.forEach((router) => {
    router.nodes.forEach((node) => {
      const assigned = assignedCounts[node.nodeId] ?? 0;
      utilization[node.nodeId] = node.capacity.maxConcurrent
        ? assigned / node.capacity.maxConcurrent
        : 0;
    });
  });

  const dropRate = requests.length === 0 ? 0 : (requests.length - served) / requests.length;
  const metrics: EndToEndMetrics = {
    totalRequests: requests.length,
    servedRequests: served,
    droppedRequests: requests.length - served,
    dropRate,
    costPerRequestAvg: served === 0 ? 0 : totalCost / served,
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    avgLatencyMs: avgLatency(latencies),
    nodeUtilization: utilization,
    federation,
    payment,
    drops,
  };

  return {
    baseConfig: config,
    metrics,
  };
};

export const formatEndToEndSummary = (report: EndToEndReport): string => {
  const { metrics } = report;
  return (
    `# End-to-End Simulation Summary\n\n` +
    `- Total requests: ${metrics.totalRequests}\n` +
    `- Served requests: ${metrics.servedRequests}\n` +
    `- Dropped requests: ${metrics.droppedRequests}\n` +
    `- Drop rate: ${(metrics.dropRate * 100).toFixed(2)}%\n` +
    `- Avg cost per request: ${metrics.costPerRequestAvg.toFixed(6)}\n` +
    `- Avg latency (ms): ${metrics.avgLatencyMs.toFixed(1)}\n` +
    `- p50 latency (ms): ${metrics.p50LatencyMs}\n` +
    `- p95 latency (ms): ${metrics.p95LatencyMs}\n` +
    `- Federation attempts: ${metrics.federation.attempts}\n` +
    `- Federation success: ${metrics.federation.success}\n` +
    `- Federation bids: ${metrics.federation.bids}\n` +
    `- Federation awards: ${metrics.federation.awards}\n` +
    `- Payment flow: ${metrics.payment.flow}\n` +
    `- Payment failures: ${metrics.payment.failures}\n` +
    `- Receipt failures: ${metrics.payment.receiptFailures}\n`
  );
};
