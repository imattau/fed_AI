export type Envelope<T> = {
  payload: T;
  nonce: string;
  ts: number;
  keyId: string;
  sig: string;
};

export type PayeeType = 'node' | 'router';

export type PaymentSplit = {
  payeeType: PayeeType;
  payeeId: string;
  amountSats: number;
  role?: 'node-inference' | 'router-fee' | 'other';
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
  latencyEstimateMs?: number;
  jobTypes?: RouterJobType[];
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
  jobType?: RouterJobType;
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
  payeeType: PayeeType;
  payeeId: string;
  amountSats: number;
  invoice: string;
  expiresAtMs: number;
  paymentHash?: string;
  splits?: PaymentSplit[];
  metadata?: Record<string, string>;
};

export type PaymentReceipt = {
  requestId: string;
  payeeType: PayeeType;
  payeeId: string;
  amountSats: number;
  paidAtMs: number;
  paymentHash?: string;
  preimage?: string;
  invoice?: string;
  splits?: PaymentSplit[];
};

export type InferenceRequest = {
  requestId: string;
  modelId: string;
  prompt: string;
  maxTokens: number;
  temperature?: number;
  topP?: number;
  jobType?: RouterJobType;
  metadata?: Record<string, string>;
  paymentReceipts?: Envelope<PaymentReceipt>[];
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

export type InferenceStreamChunk = {
  requestId: string;
  modelId: string;
  delta: string;
  index: number;
};

export type InferenceStreamFinal = {
  response: Envelope<InferenceResponse>;
  metering: Envelope<MeteringRecord>;
};

export type InferenceStreamError = {
  error: string;
  details?: unknown;
};

export type InferenceStreamEvent =
  | { type: 'chunk'; data: InferenceStreamChunk }
  | { type: 'final'; data: InferenceStreamFinal }
  | { type: 'error'; data: InferenceStreamError };

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

export type NodeOffloadRequest = {
  requestId: string;
  originNodeId: string;
  request: InferenceRequest;
  avoidNodeIds?: string[];
};

export type NodeRfbPayload = {
  requestId: string;
  jobType?: RouterJobType;
  sizeEstimate: {
    tokens: number;
    bytes: number;
  };
  deadlineMs: number;
  maxRuntimeMs?: number;
};

export type NodeBidPayload = {
  requestId: string;
  nodeId?: string;
  priceMsat?: number;
  etaMs: number;
  bidExpiryMs: number;
};

export type NodeAwardPayload = {
  requestId: string;
  winnerKeyId: string;
  acceptedPriceMsat?: number;
  awardExpiryMs: number;
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

export type RouterJobType =
  | 'EMBEDDING'
  | 'RERANK'
  | 'CLASSIFY'
  | 'MODERATE'
  | 'TOOL_CALL'
  | 'SUMMARISE'
  | 'GEN_CHUNK';

export type RouterPrivacyLevel = 'PL0' | 'PL1' | 'PL2' | 'PL3';

export type RouterBackpressureState = 'NORMAL' | 'BUSY' | 'SATURATED';

export type RouterPricingUnit = 'PER_JOB' | 'PER_1K_TOKENS' | 'PER_MB' | 'PER_SECOND';

export type RouterValidationMode = 'NONE' | 'HASH_ONLY' | 'REDUNDANT_N' | 'DETERMINISTIC_CHECK';

export type RouterFederationMessageType =
  | 'CAPS_ANNOUNCE'
  | 'PRICE_ANNOUNCE'
  | 'STATUS_ANNOUNCE'
  | 'RFB'
  | 'BID'
  | 'AWARD'
  | 'CANCEL'
  | 'RECEIPT_SUMMARY';

export type RouterControlMessage<T> = {
  type: RouterFederationMessageType;
  version: string;
  routerId: string;
  messageId: string;
  timestamp: number;
  expiry: number;
  payload: T;
  sig: string;
  prevMessageId?: string;
};

export type RouterLoadSummary = {
  queueDepth: number;
  p95LatencyMs: number;
  cpuPct: number;
  ramPct: number;
  activeJobs: number;
  backpressureState: RouterBackpressureState;
};

export type RouterCapabilityProfile = {
  routerId: string;
  transportEndpoints: string[];
  supportedJobTypes: RouterJobType[];
  resourceLimits: {
    maxPayloadBytes: number;
    maxTokens: number;
    maxConcurrency: number;
  };
  modelCaps: Array<{
    modelId: string;
    contextWindow?: number;
    tools?: string[];
  }>;
  privacyCaps: {
    maxLevel: RouterPrivacyLevel;
  };
  settlementCaps: {
    methods: string[];
    currency: string;
  };
  attestation?: {
    buildHash?: string;
    policyStatement?: string;
  };
  timestamp: number;
  expiry: number;
  loadSummary?: RouterLoadSummary;
};

export type RouterPriceSheet = {
  routerId: string;
  jobType: RouterJobType;
  unit: RouterPricingUnit;
  basePriceMsat: number;
  surgeModel?: string;
  currentSurge: number;
  slaTargets?: {
    maxQueueMs: number;
    expectedRuntimeMs: number;
  };
  timestamp: number;
  expiry: number;
};

export type RouterStatusPayload = {
  routerId: string;
  loadSummary: RouterLoadSummary;
  timestamp: number;
  expiry: number;
};

export type RouterRfbPayload = {
  jobId: string;
  jobType: RouterJobType;
  privacyLevel: RouterPrivacyLevel;
  sizeEstimate: {
    tokens?: number;
    bytes?: number;
    items?: number;
  };
  deadlineMs: number;
  maxPriceMsat: number;
  requiredCaps?: {
    modelId?: string;
    tools?: string[];
  };
  validationMode: RouterValidationMode;
  transportHint?: string;
  payloadDescriptor?: Record<string, string>;
  jobHash: string;
};

export type RouterBidPayload = {
  jobId: string;
  priceMsat: number;
  etaMs: number;
  capacityToken: string;
  constraints?: {
    maxRuntimeMs?: number;
    maxTokens?: number;
  };
  bidHash: string;
};

export type RouterAwardPayload = {
  jobId: string;
  winnerRouterId: string;
  acceptedPriceMsat: number;
  awardExpiry: number;
  dataPlaneSession?: {
    sessionEndpoint?: string;
    keyAgreement?: string;
  };
  paymentTerms?: {
    mode: 'prepay' | 'postpay' | 'escrow';
    maxCostMsat?: number;
  };
  awardHash: string;
};

export type RouterJobSubmit = {
  jobId: string;
  jobType: RouterJobType;
  privacyLevel: RouterPrivacyLevel;
  payload: string;
  contextMinimisation?: Record<string, string>;
  inputHash: string;
  maxCostMsat: number;
  maxRuntimeMs: number;
  returnEndpoint: string;
};

export type RouterJobResult = {
  jobId: string;
  resultPayload: string;
  outputHash: string;
  usage: {
    tokens?: number;
    runtimeMs?: number;
    bytesIn?: number;
    bytesOut?: number;
  };
  resultStatus: 'OK' | 'PARTIAL' | 'FAIL';
  errorCode?: string;
  receipt: RouterReceipt;
};

export type RouterReceipt = {
  jobId: string;
  requestRouterId: string;
  workerRouterId: string;
  inputHash: string;
  outputHash?: string;
  usage: {
    tokens?: number;
    runtimeMs?: number;
    bytesIn?: number;
    bytesOut?: number;
  };
  priceMsat: number;
  status: 'OK' | 'PARTIAL' | 'FAIL';
  startedAtMs: number;
  finishedAtMs: number;
  receiptId: string;
  sig: string;
};

export type RouterReceiptSummary = {
  routerId: string;
  receiptId: string;
  receiptHash: string;
  timestamp: number;
  expiry: number;
};
