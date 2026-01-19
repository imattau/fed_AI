type RedactionValue = Record<string, unknown> | unknown[] | string | number | boolean | null | undefined;

const REDACT_KEYS = new Set([
  'prompt',
  'output',
  'sig',
  'signature',
  'privateKey',
  'apiKey',
  'authorization',
  'auth',
  'token',
  'secret',
  'invoice',
  'preimage',
  'paymentHash',
]);

const sanitize = (value: unknown, seen = new WeakSet<object>()): RedactionValue => {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value !== 'object') {
    if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
      return String(value);
    }
    return value as RedactionValue;
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (seen.has(value)) {
    return '[REDACTED]';
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) => sanitize(entry, seen));
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (REDACT_KEYS.has(key) || /key|secret|token|auth|password|sig/i.test(key)) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = sanitize(entry, seen);
    }
  }
  return result;
};

const serialize = (value: unknown): string => {
  try {
    return JSON.stringify(sanitize(value));
  } catch {
    return '[unserializable]';
  }
};

export const logInfo = (message: string, meta?: unknown): void => {
  if (meta === undefined) {
    console.log(message);
    return;
  }
  console.log(message, serialize(meta));
};

export const logWarn = (message: string, meta?: unknown): void => {
  if (meta === undefined) {
    console.warn(message);
    return;
  }
  console.warn(message, serialize(meta));
};
