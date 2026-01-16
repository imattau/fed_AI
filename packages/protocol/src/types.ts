export type Envelope<T> = {
  payload: T;
  nonce: string;
  ts: number;
  keyId: string;
  sig: string;
};

export type Capability = {
  modelId: string;
  contextWindow: number;
  maxTokens: number;
  pricing: {
    unit: 'token' | 'second';
    inputRate: number;
    outputRate: number;
    currency: string;
  };
};

export type ModelInfo = {
  id: string;
  family?: string;
  version?: string;
  contextWindow: number;
};

export type NodeDescriptor = {
  nodeId: string;
  keyId: string;
  endpoint: string;
  region?: string;
  capacity: {
    maxConcurrent: number;
    currentLoad: number;
  };
  capabilities: Capability[];
  trustScore?: number;
  lastHeartbeatMs?: number;
};

export type QuoteRequest = {
  requestId: string;
  modelId: string;
  maxTokens: number;
  inputTokensEstimate: number;
  outputTokensEstimate: number;
  constraints?: {
    regions?: string[];
    minTrustScore?: number;
    maxPrice?: number;
  };
};

export type QuoteResponse = {
  requestId: string;
  modelId: string;
  nodeId: string;
  price: {
    total: number;
    currency: string;
  };
  latencyEstimateMs: number;
  expiresAtMs: number;
};

export type InferenceRequest = {
  requestId: string;
  modelId: string;
  prompt: string;
  maxTokens: number;
  temperature?: number;
  topP?: number;
  metadata?: Record<string, string>;
};

export type InferenceResponse = {
  requestId: string;
  modelId: string;
  output: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  latencyMs: number;
};

export type MeteringRecord = {
  requestId: string;
  nodeId: string;
  modelId: string;
  promptHash: string;
  inputTokens: number;
  outputTokens: number;
  wallTimeMs: number;
  bytesIn: number;
  bytesOut: number;
  ts: number;
};

export type Attestation = {
  nodeId: string;
  attestationType: string;
  evidence: string;
  ts: number;
};
