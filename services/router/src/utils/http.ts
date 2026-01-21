import { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import {
  Envelope,
  NonceStore,
  checkReplay,
  isNostrNpub,
  parsePublicKey,
  validateEnvelope,
  verifyEnvelope,
} from '@fed-ai/protocol';
import type { EnvelopeWorkerPool } from '../workers/envelope-worker-pool';
import type { EnvelopeValidatorName } from '../workers/types';

export const readJsonBody = async (
  req: IncomingMessage,
  maxBytes?: number,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> => {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (maxBytes !== undefined && totalBytes > maxBytes) {
      return { ok: false, error: 'payload-too-large' };
    }
    chunks.push(buffer);
  }
  const body = Buffer.concat(chunks).toString('utf8');
  if (!body) {
    return { ok: false, error: 'empty-body' };
  }
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch (error) {
    return { ok: false, error: 'invalid-json' };
  }
};

export const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
};

export const startSse = (res: ServerResponse): void => {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
};

export const sendSseEvent = (res: ServerResponse, event: string, data: unknown): void => {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
};

export const bodyErrorStatus = (error: string): number => {
  return error === 'payload-too-large' ? 413 : 400;
};

export const isEnvelopeLike = (value: unknown): value is Envelope<unknown> => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return ['payload', 'nonce', 'ts', 'keyId', 'sig'].every((key) => key in value);
};

export const hashString = (value: string): string => {
  return createHash('sha256').update(value, 'utf8').digest('hex');
};

export const parseSignedEnvelope = <T>(
  raw: unknown,
  validator: (value: unknown) => { ok: true } | { ok: false; errors: string[] },
  nonceStore: NonceStore,
): { ok: true; envelope: Envelope<T> } | { ok: false; error: string; details?: string[] } => {
  if (!isEnvelopeLike(raw)) {
    return { ok: false, error: 'missing-envelope' };
  }
  const validation = validateEnvelope(raw, validator);
  if (!validation.ok) {
    return { ok: false, error: 'invalid-envelope', details: validation.errors };
  }
  const envelope = raw as Envelope<T>;
  if (!isNostrNpub(envelope.keyId)) {
    return { ok: false, error: 'invalid-key-id' };
  }
  const replay = checkReplay(envelope, nonceStore);
  if (!replay.ok) {
    return { ok: false, error: replay.error ?? 'replay-error' };
  }
  const publicKey = parsePublicKey(envelope.keyId);
  if (!verifyEnvelope(envelope, publicKey)) {
    return { ok: false, error: 'invalid-signature' };
  }
  return { ok: true, envelope };
};

export type EnvelopeValidator = (value: unknown) => { ok: true } | { ok: false; errors: string[] };

export const validateSignedEnvelope = async <T>(
  raw: unknown,
  validatorName: EnvelopeValidatorName,
  validator: EnvelopeValidator,
  workerPool: EnvelopeWorkerPool | null,
  publicKeyHex?: string,
): Promise<
  | { ok: true; envelope: Envelope<T> }
  | { ok: false; status: number; error: string; details?: string[] }
> => {
  if (workerPool) {
    try {
      const workerResult = await workerPool.validateAndVerify({
        envelope: raw,
        validator: validatorName,
        publicKeyHex,
      });
      if (workerResult.ok) {
        const envelope = raw as Envelope<T>;
        if (!isNostrNpub(envelope.keyId)) {
          return { ok: false, status: 400, error: 'invalid-key-id' };
        }
        return { ok: true, envelope };
      }
      if (workerResult.error === 'invalid-envelope') {
        return {
          ok: false,
          status: 400,
          error: 'invalid-envelope',
          details: workerResult.errors,
        };
      }
      if (workerResult.error === 'invalid-key-id') {
        return { ok: false, status: 400, error: 'invalid-key-id' };
      }
      if (workerResult.error === 'invalid-signature') {
        return { ok: false, status: 401, error: 'invalid-signature' };
      }
    } catch {
      // Fall through to synchronous validation on worker failure.
    }
  }

  const validation = validateEnvelope(raw, validator);
  if (!validation.ok) {
    return { ok: false, status: 400, error: 'invalid-envelope', details: validation.errors };
  }
  const envelope = raw as Envelope<T>;
  if (!isNostrNpub(envelope.keyId)) {
    return { ok: false, status: 400, error: 'invalid-key-id' };
  }
  const publicKey = publicKeyHex ? Buffer.from(publicKeyHex, 'hex') : parsePublicKey(envelope.keyId);
  if (!verifyEnvelope(envelope, publicKey)) {
    return { ok: false, status: 401, error: 'invalid-signature' };
  }
  return { ok: true, envelope };
};
