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
  PaymentReceipt,
  PaymentRequest,
  ProtocolError,
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

const paymentRequestSchema: z.ZodType<PaymentRequest> = z.object({
  requestId: z.string(),
  nodeId: z.string(),
  amountSats: z.number(),
  invoice: z.string(),
  expiresAtMs: z.number(),
  paymentHash: z.string().optional(),
  metadata: z.record(z.string()).optional(),
});

const paymentReceiptSchema: z.ZodType<PaymentReceipt> = z.object({
  requestId: z.string(),
  nodeId: z.string(),
  amountSats: z.number(),
  paidAtMs: z.number(),
  paymentHash: z.string().optional(),
  preimage: z.string().optional(),
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
  metadata: z.record(z.string()).optional(),
  paymentReceipt: envelopeSchema(paymentReceiptSchema).optional(),
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
