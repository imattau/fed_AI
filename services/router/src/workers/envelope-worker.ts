import { parentPort } from 'node:worker_threads';
import {
  parsePublicKey,
  validateEnvelope,
  verifyEnvelope,
  validateInferenceRequest,
  validateInferenceResponse,
  validateQuoteRequest,
  validatePaymentReceipt,
  validateMeteringRecord,
  validateNodeDescriptor,
  validateStakeCommit,
  validateStakeSlash,
  validateNodeOffloadRequest,
} from '@fed-ai/protocol';
import type { Envelope } from '@fed-ai/protocol';
import type { EnvelopeWorkerResult, EnvelopeWorkerTask, EnvelopeValidatorName } from './types';

type Validator = (value: unknown) => { ok: true } | { ok: false; errors: string[] };

const validators: Record<EnvelopeValidatorName, Validator> = {
  InferenceRequest: validateInferenceRequest,
  InferenceResponse: validateInferenceResponse,
  QuoteRequest: validateQuoteRequest,
  PaymentReceipt: validatePaymentReceipt,
  MeteringRecord: validateMeteringRecord,
  NodeDescriptor: validateNodeDescriptor,
  StakeCommit: validateStakeCommit,
  StakeSlash: validateStakeSlash,
  NodeOffloadRequest: validateNodeOffloadRequest,
};

const handleValidateAndVerify = (
  task: EnvelopeWorkerTask,
): EnvelopeWorkerResult => {
  const { envelope, validator, keyId, publicKeyHex } = task.payload;
  const validatorFn = validators[validator];
  if (!validatorFn) {
    return { id: task.id, ok: false, error: 'unknown-validator' };
  }

  const validation = validateEnvelope(envelope, validatorFn);
  if (!validation.ok) {
    return { id: task.id, ok: false, error: 'invalid-envelope', errors: validation.errors };
  }

  const typedEnvelope = envelope as Envelope<unknown>;
  let publicKey: Uint8Array;
  try {
    if (publicKeyHex) {
      publicKey = Buffer.from(publicKeyHex, 'hex');
    } else if (keyId) {
      publicKey = parsePublicKey(keyId);
    } else if (typedEnvelope.keyId) {
      publicKey = parsePublicKey(typedEnvelope.keyId);
    } else {
      return { id: task.id, ok: false, error: 'invalid-key-id' };
    }
  } catch (error) {
    return { id: task.id, ok: false, error: 'invalid-key-id' };
  }

  if (!verifyEnvelope(typedEnvelope, publicKey)) {
    return { id: task.id, ok: false, error: 'invalid-signature' };
  }

  return { id: task.id, ok: true };
};

if (parentPort) {
  const port = parentPort;
  port.on('message', (task: EnvelopeWorkerTask) => {
    try {
      if (task.type === 'validateAndVerify') {
        port.postMessage(handleValidateAndVerify(task));
        return;
      }
      port.postMessage({
        id: task.id,
        ok: false,
        error: 'worker-error',
        details: 'unknown-task-type',
      } satisfies EnvelopeWorkerResult);
    } catch (error) {
      port.postMessage({
        id: task.id,
        ok: false,
        error: 'worker-error',
        details: error instanceof Error ? error.message : 'worker-failure',
      } satisfies EnvelopeWorkerResult);
    }
  });
}
