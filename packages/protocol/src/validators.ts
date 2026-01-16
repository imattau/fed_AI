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
  QuoteRequest,
  QuoteResponse,
} from './types';

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

type Validator<T> = (value: unknown) => ValidationResult;

const okResult: ValidationResult = { ok: true };

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && !Number.isNaN(value);
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => isString(item));

const validateObject = (value: unknown, name: string): string[] => {
  if (!isRecord(value)) {
    return [`${name} must be an object`];
  }
  return [];
};

const requireString = (record: Record<string, unknown>, key: string, errors: string[]): void => {
  if (!isString(record[key])) {
    errors.push(`${key} must be a string`);
  }
};

const requireNumber = (record: Record<string, unknown>, key: string, errors: string[]): void => {
  if (!isNumber(record[key])) {
    errors.push(`${key} must be a number`);
  }
};

const requireBoolean = (record: Record<string, unknown>, key: string, errors: string[]): void => {
  if (!isBoolean(record[key])) {
    errors.push(`${key} must be a boolean`);
  }
};

const validateErrors = (errors: string[]): ValidationResult => {
  if (errors.length === 0) {
    return okResult;
  }
  return { ok: false, errors };
};

export const validateCapability: Validator<Capability> = (value: unknown): ValidationResult => {
  const errors = validateObject(value, 'Capability');
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const record = value as Record<string, unknown>;
  requireString(record, 'modelId', errors);
  requireNumber(record, 'contextWindow', errors);
  requireNumber(record, 'maxTokens', errors);

  if (!isRecord(record.pricing)) {
    errors.push('pricing must be an object');
  } else {
    const pricing = record.pricing as Record<string, unknown>;
    if (pricing.unit !== 'token' && pricing.unit !== 'second') {
      errors.push('pricing.unit must be "token" or "second"');
    }
    requireNumber(pricing, 'inputRate', errors);
    requireNumber(pricing, 'outputRate', errors);
    requireString(pricing, 'currency', errors);
  }

  return validateErrors(errors);
};

export const validateModelInfo: Validator<ModelInfo> = (value: unknown): ValidationResult => {
  const errors = validateObject(value, 'ModelInfo');
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const record = value as Record<string, unknown>;
  requireString(record, 'id', errors);
  requireNumber(record, 'contextWindow', errors);
  return validateErrors(errors);
};

export const validateNodeDescriptor: Validator<NodeDescriptor> = (value: unknown): ValidationResult => {
  const errors = validateObject(value, 'NodeDescriptor');
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const record = value as Record<string, unknown>;
  requireString(record, 'nodeId', errors);
  requireString(record, 'keyId', errors);
  requireString(record, 'endpoint', errors);

  if (!isRecord(record.capacity)) {
    errors.push('capacity must be an object');
  } else {
    const capacity = record.capacity as Record<string, unknown>;
    requireNumber(capacity, 'maxConcurrent', errors);
    requireNumber(capacity, 'currentLoad', errors);
  }

  if (!Array.isArray(record.capabilities)) {
    errors.push('capabilities must be an array');
  } else {
    record.capabilities.forEach((capability, index) => {
      const result = validateCapability(capability);
      if (!result.ok) {
        result.errors.forEach((error) => errors.push(`capabilities[${index}]: ${error}`));
      }
    });
  }

  return validateErrors(errors);
};

export const validateQuoteRequest: Validator<QuoteRequest> = (value: unknown): ValidationResult => {
  const errors = validateObject(value, 'QuoteRequest');
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const record = value as Record<string, unknown>;
  requireString(record, 'requestId', errors);
  requireString(record, 'modelId', errors);
  requireNumber(record, 'maxTokens', errors);
  requireNumber(record, 'inputTokensEstimate', errors);
  requireNumber(record, 'outputTokensEstimate', errors);

  if (record.constraints !== undefined) {
    if (!isRecord(record.constraints)) {
      errors.push('constraints must be an object');
    } else {
      const constraints = record.constraints as Record<string, unknown>;
      if (constraints.regions !== undefined && !isStringArray(constraints.regions)) {
        errors.push('constraints.regions must be an array of strings');
      }
      if (constraints.minTrustScore !== undefined && !isNumber(constraints.minTrustScore)) {
        errors.push('constraints.minTrustScore must be a number');
      }
      if (constraints.maxPrice !== undefined && !isNumber(constraints.maxPrice)) {
        errors.push('constraints.maxPrice must be a number');
      }
    }
  }

  return validateErrors(errors);
};

export const validateQuoteResponse: Validator<QuoteResponse> = (value: unknown): ValidationResult => {
  const errors = validateObject(value, 'QuoteResponse');
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const record = value as Record<string, unknown>;
  requireString(record, 'requestId', errors);
  requireString(record, 'modelId', errors);
  requireString(record, 'nodeId', errors);
  requireNumber(record, 'latencyEstimateMs', errors);
  requireNumber(record, 'expiresAtMs', errors);

  if (!isRecord(record.price)) {
    errors.push('price must be an object');
  } else {
    const price = record.price as Record<string, unknown>;
    requireNumber(price, 'total', errors);
    requireString(price, 'currency', errors);
  }

  return validateErrors(errors);
};

export const validatePaymentRequest: Validator<PaymentRequest> = (value: unknown): ValidationResult => {
  const errors = validateObject(value, 'PaymentRequest');
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const record = value as Record<string, unknown>;
  requireString(record, 'requestId', errors);
  requireString(record, 'nodeId', errors);
  requireNumber(record, 'amountSats', errors);
  requireString(record, 'invoice', errors);
  requireNumber(record, 'expiresAtMs', errors);

  if (record.paymentHash !== undefined && !isString(record.paymentHash)) {
    errors.push('paymentHash must be a string');
  }
  if (record.metadata !== undefined && !isRecord(record.metadata)) {
    errors.push('metadata must be an object');
  }

  return validateErrors(errors);
};

export const validatePaymentReceipt: Validator<PaymentReceipt> = (value: unknown): ValidationResult => {
  const errors = validateObject(value, 'PaymentReceipt');
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const record = value as Record<string, unknown>;
  requireString(record, 'requestId', errors);
  requireString(record, 'nodeId', errors);
  requireNumber(record, 'amountSats', errors);
  requireNumber(record, 'paidAtMs', errors);

  if (record.paymentHash !== undefined && !isString(record.paymentHash)) {
    errors.push('paymentHash must be a string');
  }
  if (record.preimage !== undefined && !isString(record.preimage)) {
    errors.push('preimage must be a string');
  }

  return validateErrors(errors);
};

export const validateInferenceRequest: Validator<InferenceRequest> = (value: unknown): ValidationResult => {
  const errors = validateObject(value, 'InferenceRequest');
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const record = value as Record<string, unknown>;
  requireString(record, 'requestId', errors);
  requireString(record, 'modelId', errors);
  requireString(record, 'prompt', errors);
  requireNumber(record, 'maxTokens', errors);

  if (record.temperature !== undefined && !isNumber(record.temperature)) {
    errors.push('temperature must be a number');
  }
  if (record.topP !== undefined && !isNumber(record.topP)) {
    errors.push('topP must be a number');
  }
  if (record.metadata !== undefined && !isRecord(record.metadata)) {
    errors.push('metadata must be an object');
  }

  return validateErrors(errors);
};

export const validateInferenceResponse: Validator<InferenceResponse> = (value: unknown): ValidationResult => {
  const errors = validateObject(value, 'InferenceResponse');
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const record = value as Record<string, unknown>;
  requireString(record, 'requestId', errors);
  requireString(record, 'modelId', errors);
  requireString(record, 'output', errors);
  requireNumber(record, 'latencyMs', errors);

  if (!isRecord(record.usage)) {
    errors.push('usage must be an object');
  } else {
    const usage = record.usage as Record<string, unknown>;
    requireNumber(usage, 'inputTokens', errors);
    requireNumber(usage, 'outputTokens', errors);
  }

  return validateErrors(errors);
};

export const validateMeteringRecord: Validator<MeteringRecord> = (value: unknown): ValidationResult => {
  const errors = validateObject(value, 'MeteringRecord');
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const record = value as Record<string, unknown>;
  requireString(record, 'requestId', errors);
  requireString(record, 'nodeId', errors);
  requireString(record, 'modelId', errors);
  requireString(record, 'promptHash', errors);
  requireNumber(record, 'inputTokens', errors);
  requireNumber(record, 'outputTokens', errors);
  requireNumber(record, 'wallTimeMs', errors);
  requireNumber(record, 'bytesIn', errors);
  requireNumber(record, 'bytesOut', errors);
  requireNumber(record, 'ts', errors);

  return validateErrors(errors);
};

export const validateProtocolError: Validator<ProtocolError> = (value: unknown): ValidationResult => {
  const errors = validateObject(value, 'ProtocolError');
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const record = value as Record<string, unknown>;
  requireString(record, 'code', errors);
  requireString(record, 'message', errors);
  if (record.retryable !== undefined && !isBoolean(record.retryable)) {
    errors.push('retryable must be a boolean');
  }
  if (record.details !== undefined && !isRecord(record.details)) {
    errors.push('details must be an object');
  }

  return validateErrors(errors);
};

export const validateAttestation: Validator<Attestation> = (value: unknown): ValidationResult => {
  const errors = validateObject(value, 'Attestation');
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const record = value as Record<string, unknown>;
  requireString(record, 'nodeId', errors);
  requireString(record, 'attestationType', errors);
  requireString(record, 'evidence', errors);
  requireNumber(record, 'ts', errors);

  return validateErrors(errors);
};

export const validateEnvelope = <T>(
  value: unknown,
  payloadValidator: Validator<T>,
): ValidationResult => {
  const errors = validateObject(value, 'Envelope');
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const record = value as Record<string, unknown>;
  requireString(record, 'nonce', errors);
  requireNumber(record, 'ts', errors);
  requireString(record, 'keyId', errors);
  requireString(record, 'sig', errors);

  if (!('payload' in record)) {
    errors.push('payload is required');
  } else {
    const payloadResult = payloadValidator(record.payload);
    if (!payloadResult.ok) {
      payloadResult.errors.forEach((error) => errors.push(`payload: ${error}`));
    }
  }

  return validateErrors(errors);
};

export type { ValidationResult, Validator };
