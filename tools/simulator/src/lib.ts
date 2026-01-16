import { selectNode } from '@fed-ai/router';
import type { NodeDescriptor, QuoteRequest } from '@fed-ai/protocol';

export type SimulationConfig = {
  nodes: number;
  requests: number;
  seed: number;
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

const percentile = (values: number[], percentileValue: number): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * percentileValue));
  return sorted[index];
};

export const runSimulation = (config: SimulationConfig): SimulationMetrics => {
  const rng = createRng(config.seed);
  const nodes = generateNodes(config.nodes, rng);
  const requests = generateRequests(config.requests, rng);

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

  const dropRate = config.requests === 0 ? 0 : (config.requests - served) / config.requests;

  return {
    totalRequests: config.requests,
    servedRequests: served,
    droppedRequests: config.requests - served,
    dropRate,
    costPerRequestAvg: served === 0 ? 0 : totalCost / served,
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    nodeUtilization: utilization,
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
