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

export type PaymentRequest = {
  requestId: string;
  nodeId: string;
  amountSats: number;
  invoice: string;
  expiresAtMs: number;
  paymentHash?: string;
  metadata?: Record<string, string>;
};

export type PaymentReceipt = {
  requestId: string;
  nodeId: string;
  amountSats: number;
  paidAtMs: number;
  paymentHash?: string;
  preimage?: string;
};

export type InferenceRequest = {
  requestId: string;
  modelId: string;
  prompt: string;
  maxTokens: number;
  temperature?: number;
  topP?: number;
  metadata?: Record<string, string>;
  paymentReceipt?: Envelope<PaymentReceipt>;
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

export type ProtocolError = {
  code: string;
  message: string;
  retryable?: boolean;
  details?: Record<string, string>;
};

export type StakeCommit = {
  stakeId: string;
  actorId: string;
  actorType: 'node' | 'router' | 'client';
  units: number;
  committedAtMs: number;
  expiresAtMs: number;
  metadata?: Record<string, string>;
};

export type StakeSlash = {
  slashId: string;
  stakeId: string;
  actorId: string;
  units: number;
  reason: string;
  ts: number;
};

export type Attestation = {
  nodeId: string;
  attestationType: string;
  evidence: string;
  ts: number;
};
