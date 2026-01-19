export type EnvelopeValidatorName =
  | 'InferenceRequest'
  | 'InferenceResponse'
  | 'QuoteRequest'
  | 'PaymentReceipt'
  | 'MeteringRecord'
  | 'NodeDescriptor'
  | 'StakeCommit'
  | 'StakeSlash'
  | 'NodeOffloadRequest';

export type EnvelopeWorkerTask = {
  id: number;
  type: 'validateAndVerify';
  payload: {
    envelope: unknown;
    validator: EnvelopeValidatorName;
    keyId?: string;
    publicKeyHex?: string;
  };
};

export type EnvelopeWorkerResult =
  | { id: number; ok: true }
  | { id: number; ok: false; error: 'invalid-envelope'; errors: string[] }
  | { id: number; ok: false; error: 'invalid-key-id' }
  | { id: number; ok: false; error: 'invalid-signature' }
  | { id: number; ok: false; error: 'unknown-validator' }
  | { id: number; ok: false; error: 'worker-error'; details?: string };
