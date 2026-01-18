import { z } from 'zod';
import type {
  Attestation,
  Capability,
  Envelope,
  InferenceRequest,
  InferenceResponse,
  MeteringRecord,
  ModelInfo,
  NodeDescriptor,
  PayeeType,
  PaymentReceipt,
  PaymentRequest,
  ProtocolError,
  RouterAwardPayload,
  RouterBackpressureState,
  RouterBidPayload,
  RouterCapabilityProfile,
  RouterControlMessage,
  RouterFederationMessageType,
  RouterJobResult,
  RouterJobSubmit,
  RouterJobType,
  RouterLoadSummary,
  RouterPriceSheet,
  RouterPricingUnit,
  RouterPrivacyLevel,
  RouterReceipt,
  RouterReceiptSummary,
  RouterRfbPayload,
  RouterStatusPayload,
  RouterValidationMode,
  StakeCommit,
  StakeSlash,
  QuoteRequest,
  QuoteResponse,
} from './types';

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

type Validator<T> = (value: unknown) => ValidationResult;

const okResult: ValidationResult = { ok: true };

const toErrors = (issues: z.ZodIssue[]): string[] => {
  return issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'value';
    return `${path}: ${issue.message}`;
  });
};

const validateWithSchema = <T>(schema: z.ZodType<T>, value: unknown): ValidationResult => {
  const result = schema.safeParse(value);
  if (result.success) {
    return okResult;
  }
  return { ok: false, errors: toErrors(result.error.issues) };
};

const routerJobTypeSchema: z.ZodType<RouterJobType> = z.union([
  z.literal('EMBEDDING'),
  z.literal('RERANK'),
  z.literal('CLASSIFY'),
  z.literal('MODERATE'),
  z.literal('TOOL_CALL'),
  z.literal('SUMMARISE'),
  z.literal('GEN_CHUNK'),
]);

const pricingSchema = z.object({
  unit: z.union([z.literal('token'), z.literal('second')]),
  inputRate: z.number(),
  outputRate: z.number(),
  currency: z.string(),
});

const capabilitySchema: z.ZodType<Capability> = z.object({
  modelId: z.string(),
  contextWindow: z.number(),
  maxTokens: z.number(),
  pricing: pricingSchema,
  latencyEstimateMs: z.number().optional(),
  jobTypes: z.array(routerJobTypeSchema).optional(),
});

const modelInfoSchema: z.ZodType<ModelInfo> = z.object({
  id: z.string(),
  family: z.string().optional(),
  version: z.string().optional(),
  contextWindow: z.number(),
});

const nodeDescriptorSchema: z.ZodType<NodeDescriptor> = z.object({
  nodeId: z.string(),
  keyId: z.string(),
  endpoint: z.string(),
  region: z.string().optional(),
  capacity: z.object({
    maxConcurrent: z.number(),
    currentLoad: z.number(),
  }),
  capabilities: z.array(capabilitySchema),
  trustScore: z.number().optional(),
  lastHeartbeatMs: z.number().optional(),
});

const quoteRequestSchema: z.ZodType<QuoteRequest> = z.object({
  requestId: z.string(),
  modelId: z.string(),
  maxTokens: z.number(),
  inputTokensEstimate: z.number(),
  outputTokensEstimate: z.number(),
  jobType: routerJobTypeSchema.optional(),
  constraints: z
    .object({
      regions: z.array(z.string()).optional(),
      minTrustScore: z.number().optional(),
      maxPrice: z.number().optional(),
    })
    .optional(),
});

const quoteResponseSchema: z.ZodType<QuoteResponse> = z.object({
  requestId: z.string(),
  modelId: z.string(),
  nodeId: z.string(),
  price: z.object({
    total: z.number(),
    currency: z.string(),
  }),
  latencyEstimateMs: z.number(),
  expiresAtMs: z.number(),
});

const payeeTypeSchema: z.ZodType<PayeeType> = z.union([z.literal('node'), z.literal('router')]);

const paymentRequestSchema: z.ZodType<PaymentRequest> = z.object({
  requestId: z.string(),
  payeeType: payeeTypeSchema,
  payeeId: z.string(),
  amountSats: z.number(),
  invoice: z.string(),
  expiresAtMs: z.number(),
  paymentHash: z.string().optional(),
  metadata: z.record(z.string()).optional(),
});

const paymentReceiptSchema: z.ZodType<PaymentReceipt> = z.object({
  requestId: z.string(),
  payeeType: payeeTypeSchema,
  payeeId: z.string(),
  amountSats: z.number(),
  paidAtMs: z.number(),
  paymentHash: z.string().optional(),
  preimage: z.string().optional(),
  invoice: z.string().optional(),
});

const inferenceResponseSchema: z.ZodType<InferenceResponse> = z.object({
  requestId: z.string(),
  modelId: z.string(),
  output: z.string(),
  usage: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
  }),
  latencyMs: z.number(),
});

const meteringRecordSchema: z.ZodType<MeteringRecord> = z.object({
  requestId: z.string(),
  nodeId: z.string(),
  modelId: z.string(),
  promptHash: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  wallTimeMs: z.number(),
  bytesIn: z.number(),
  bytesOut: z.number(),
  ts: z.number(),
});

const protocolErrorSchema: z.ZodType<ProtocolError> = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean().optional(),
  details: z.record(z.string()).optional(),
});

const stakeCommitSchema: z.ZodType<StakeCommit> = z.object({
  stakeId: z.string(),
  actorId: z.string(),
  actorType: z.union([z.literal('node'), z.literal('router'), z.literal('client')]),
  units: z.number(),
  committedAtMs: z.number(),
  expiresAtMs: z.number(),
  metadata: z.record(z.string()).optional(),
});

const stakeSlashSchema: z.ZodType<StakeSlash> = z.object({
  slashId: z.string(),
  stakeId: z.string(),
  actorId: z.string(),
  units: z.number(),
  reason: z.string(),
  ts: z.number(),
});

const attestationSchema: z.ZodType<Attestation> = z.object({
  nodeId: z.string(),
  attestationType: z.string(),
  evidence: z.string(),
  ts: z.number(),
});

const routerPrivacyLevelSchema: z.ZodType<RouterPrivacyLevel> = z.union([
  z.literal('PL0'),
  z.literal('PL1'),
  z.literal('PL2'),
  z.literal('PL3'),
]);

const routerBackpressureSchema: z.ZodType<RouterBackpressureState> = z.union([
  z.literal('NORMAL'),
  z.literal('BUSY'),
  z.literal('SATURATED'),
]);

const routerPricingUnitSchema: z.ZodType<RouterPricingUnit> = z.union([
  z.literal('PER_JOB'),
  z.literal('PER_1K_TOKENS'),
  z.literal('PER_MB'),
  z.literal('PER_SECOND'),
]);

const routerValidationModeSchema: z.ZodType<RouterValidationMode> = z.union([
  z.literal('NONE'),
  z.literal('HASH_ONLY'),
  z.literal('REDUNDANT_N'),
  z.literal('DETERMINISTIC_CHECK'),
]);

const routerMessageTypeSchema: z.ZodType<RouterFederationMessageType> = z.union([
  z.literal('CAPS_ANNOUNCE'),
  z.literal('PRICE_ANNOUNCE'),
  z.literal('STATUS_ANNOUNCE'),
  z.literal('RFB'),
  z.literal('BID'),
  z.literal('AWARD'),
  z.literal('CANCEL'),
  z.literal('RECEIPT_SUMMARY'),
]);

const routerLoadSummarySchema: z.ZodType<RouterLoadSummary> = z.object({
  queueDepth: z.number(),
  p95LatencyMs: z.number(),
  cpuPct: z.number(),
  ramPct: z.number(),
  activeJobs: z.number(),
  backpressureState: routerBackpressureSchema,
});

const routerCapabilityProfileSchema: z.ZodType<RouterCapabilityProfile> = z.object({
  routerId: z.string(),
  transportEndpoints: z.array(z.string()),
  supportedJobTypes: z.array(routerJobTypeSchema),
  resourceLimits: z.object({
    maxPayloadBytes: z.number(),
    maxTokens: z.number(),
    maxConcurrency: z.number(),
  }),
  modelCaps: z.array(
    z.object({
      modelId: z.string(),
      contextWindow: z.number().optional(),
      tools: z.array(z.string()).optional(),
    }),
  ),
  privacyCaps: z.object({
    maxLevel: routerPrivacyLevelSchema,
  }),
  settlementCaps: z.object({
    methods: z.array(z.string()),
    currency: z.string(),
  }),
  attestation: z
    .object({
      buildHash: z.string().optional(),
      policyStatement: z.string().optional(),
    })
    .optional(),
  timestamp: z.number(),
  expiry: z.number(),
  loadSummary: routerLoadSummarySchema.optional(),
});

const routerPriceSheetSchema: z.ZodType<RouterPriceSheet> = z.object({
  routerId: z.string(),
  jobType: routerJobTypeSchema,
  unit: routerPricingUnitSchema,
  basePriceMsat: z.number(),
  surgeModel: z.string().optional(),
  currentSurge: z.number(),
  slaTargets: z
    .object({
      maxQueueMs: z.number(),
      expectedRuntimeMs: z.number(),
    })
    .optional(),
  timestamp: z.number(),
  expiry: z.number(),
});

const routerStatusPayloadSchema: z.ZodType<RouterStatusPayload> = z.object({
  routerId: z.string(),
  loadSummary: routerLoadSummarySchema,
  timestamp: z.number(),
  expiry: z.number(),
});

const routerRfbPayloadSchema: z.ZodType<RouterRfbPayload> = z.object({
  jobId: z.string(),
  jobType: routerJobTypeSchema,
  privacyLevel: routerPrivacyLevelSchema,
  sizeEstimate: z.object({
    tokens: z.number().optional(),
    bytes: z.number().optional(),
    items: z.number().optional(),
  }),
  deadlineMs: z.number(),
  maxPriceMsat: z.number(),
  requiredCaps: z
    .object({
      modelId: z.string().optional(),
      tools: z.array(z.string()).optional(),
    })
    .optional(),
  validationMode: routerValidationModeSchema,
  transportHint: z.string().optional(),
  payloadDescriptor: z.record(z.string()).optional(),
  jobHash: z.string(),
});

const routerBidPayloadSchema: z.ZodType<RouterBidPayload> = z.object({
  jobId: z.string(),
  priceMsat: z.number(),
  etaMs: z.number(),
  capacityToken: z.string(),
  constraints: z
    .object({
      maxRuntimeMs: z.number().optional(),
      maxTokens: z.number().optional(),
    })
    .optional(),
  bidHash: z.string(),
});

const routerAwardPayloadSchema: z.ZodType<RouterAwardPayload> = z.object({
  jobId: z.string(),
  winnerRouterId: z.string(),
  acceptedPriceMsat: z.number(),
  awardExpiry: z.number(),
  dataPlaneSession: z
    .object({
      sessionEndpoint: z.string().optional(),
      keyAgreement: z.string().optional(),
    })
    .optional(),
  paymentTerms: z
    .object({
      mode: z.union([z.literal('prepay'), z.literal('postpay'), z.literal('escrow')]),
      maxCostMsat: z.number().optional(),
    })
    .optional(),
  awardHash: z.string(),
});

const routerReceiptSchema: z.ZodType<RouterReceipt> = z.object({
  jobId: z.string(),
  requestRouterId: z.string(),
  workerRouterId: z.string(),
  inputHash: z.string(),
  outputHash: z.string().optional(),
  usage: z.object({
    tokens: z.number().optional(),
    runtimeMs: z.number().optional(),
    bytesIn: z.number().optional(),
    bytesOut: z.number().optional(),
  }),
  priceMsat: z.number(),
  status: z.union([z.literal('OK'), z.literal('PARTIAL'), z.literal('FAIL')]),
  startedAtMs: z.number(),
  finishedAtMs: z.number(),
  receiptId: z.string(),
  sig: z.string(),
});

const routerJobSubmitSchema: z.ZodType<RouterJobSubmit> = z.object({
  jobId: z.string(),
  jobType: routerJobTypeSchema,
  privacyLevel: routerPrivacyLevelSchema,
  payload: z.string(),
  contextMinimisation: z.record(z.string()).optional(),
  inputHash: z.string(),
  maxCostMsat: z.number(),
  maxRuntimeMs: z.number(),
  returnEndpoint: z.string(),
});

const routerJobResultSchema: z.ZodType<RouterJobResult> = z.object({
  jobId: z.string(),
  resultPayload: z.string(),
  outputHash: z.string(),
  usage: z.object({
    tokens: z.number().optional(),
    runtimeMs: z.number().optional(),
    bytesIn: z.number().optional(),
    bytesOut: z.number().optional(),
  }),
  resultStatus: z.union([z.literal('OK'), z.literal('PARTIAL'), z.literal('FAIL')]),
  errorCode: z.string().optional(),
  receipt: routerReceiptSchema,
});

const routerReceiptSummarySchema: z.ZodType<RouterReceiptSummary> = z.object({
  routerId: z.string(),
  receiptId: z.string(),
  receiptHash: z.string(),
  timestamp: z.number(),
  expiry: z.number(),
});

const routerControlMessageSchema = <T>(payloadSchema: z.ZodType<T>): z.ZodType<RouterControlMessage<T>> => {
  return z
    .object({
      type: routerMessageTypeSchema,
      version: z.string(),
      routerId: z.string(),
      messageId: z.string(),
      timestamp: z.number(),
      expiry: z.number(),
      payload: payloadSchema,
      sig: z.string(),
      prevMessageId: z.string().optional(),
    })
    .strict() as z.ZodType<RouterControlMessage<T>>;
};

const envelopeSchema = <T>(payloadSchema: z.ZodType<T>): z.ZodType<Envelope<T>> => {
  return z
    .object({
      payload: payloadSchema,
      nonce: z.string(),
      ts: z.number(),
      keyId: z.string(),
      sig: z.string(),
    })
    .strict() as z.ZodType<Envelope<T>>;
};

const inferenceRequestSchema: z.ZodType<InferenceRequest> = z.object({
  requestId: z.string(),
  modelId: z.string(),
  prompt: z.string(),
  maxTokens: z.number(),
  temperature: z.number().optional(),
  topP: z.number().optional(),
  jobType: routerJobTypeSchema.optional(),
  metadata: z.record(z.string()).optional(),
  paymentReceipts: z.array(envelopeSchema(paymentReceiptSchema)).optional(),
});

export const validateCapability: Validator<Capability> = (value) =>
  validateWithSchema(capabilitySchema, value);

export const validateModelInfo: Validator<ModelInfo> = (value) =>
  validateWithSchema(modelInfoSchema, value);

export const validateNodeDescriptor: Validator<NodeDescriptor> = (value) =>
  validateWithSchema(nodeDescriptorSchema, value);

export const validateQuoteRequest: Validator<QuoteRequest> = (value) =>
  validateWithSchema(quoteRequestSchema, value);

export const validateQuoteResponse: Validator<QuoteResponse> = (value) =>
  validateWithSchema(quoteResponseSchema, value);

export const validatePaymentRequest: Validator<PaymentRequest> = (value) =>
  validateWithSchema(paymentRequestSchema, value);

export const validatePaymentReceipt: Validator<PaymentReceipt> = (value) =>
  validateWithSchema(paymentReceiptSchema, value);

export const validateInferenceRequest: Validator<InferenceRequest> = (value) =>
  validateWithSchema(inferenceRequestSchema, value);

export const validateInferenceResponse: Validator<InferenceResponse> = (value) =>
  validateWithSchema(inferenceResponseSchema, value);

export const validateMeteringRecord: Validator<MeteringRecord> = (value) =>
  validateWithSchema(meteringRecordSchema, value);

export const validateProtocolError: Validator<ProtocolError> = (value) =>
  validateWithSchema(protocolErrorSchema, value);

export const validateStakeCommit: Validator<StakeCommit> = (value) =>
  validateWithSchema(stakeCommitSchema, value);

export const validateStakeSlash: Validator<StakeSlash> = (value) =>
  validateWithSchema(stakeSlashSchema, value);

export const validateAttestation: Validator<Attestation> = (value) =>
  validateWithSchema(attestationSchema, value);

export const validateRouterCapabilityProfile: Validator<RouterCapabilityProfile> = (value) =>
  validateWithSchema(routerCapabilityProfileSchema, value);

export const validateRouterPriceSheet: Validator<RouterPriceSheet> = (value) =>
  validateWithSchema(routerPriceSheetSchema, value);

export const validateRouterStatusPayload: Validator<RouterStatusPayload> = (value) =>
  validateWithSchema(routerStatusPayloadSchema, value);

export const validateRouterRfbPayload: Validator<RouterRfbPayload> = (value) =>
  validateWithSchema(routerRfbPayloadSchema, value);

export const validateRouterBidPayload: Validator<RouterBidPayload> = (value) =>
  validateWithSchema(routerBidPayloadSchema, value);

export const validateRouterAwardPayload: Validator<RouterAwardPayload> = (value) =>
  validateWithSchema(routerAwardPayloadSchema, value);

export const validateRouterJobSubmit: Validator<RouterJobSubmit> = (value) =>
  validateWithSchema(routerJobSubmitSchema, value);

export const validateRouterJobResult: Validator<RouterJobResult> = (value) =>
  validateWithSchema(routerJobResultSchema, value);

export const validateRouterReceipt: Validator<RouterReceipt> = (value) =>
  validateWithSchema(routerReceiptSchema, value);

export const validateRouterReceiptSummary: Validator<RouterReceiptSummary> = (value) =>
  validateWithSchema(routerReceiptSummarySchema, value);

export const validateRouterControlMessage = <T>(
  value: unknown,
  payloadValidator: Validator<T>,
): ValidationResult => {
  const baseResult = validateWithSchema(
    routerControlMessageSchema(z.any()),
    value,
  );

  if (!baseResult.ok) {
    return baseResult;
  }

  const message = value as RouterControlMessage<T>;
  const payloadResult = payloadValidator(message.payload);
  if (!payloadResult.ok) {
    return { ok: false, errors: payloadResult.errors.map((error) => `payload: ${error}`) };
  }

  return okResult;
};

export const validateEnvelope = <T>(value: unknown, payloadValidator: Validator<T>): ValidationResult => {
  const baseResult = validateWithSchema(
    envelopeSchema(z.any()),
    value,
  );

  if (!baseResult.ok) {
    return baseResult;
  }

  const envelope = value as Envelope<T>;
  const payloadResult = payloadValidator(envelope.payload);
  if (!payloadResult.ok) {
    return { ok: false, errors: payloadResult.errors.map((error) => `payload: ${error}`) };
  }

  return okResult;
};

export type { ValidationResult, Validator };
