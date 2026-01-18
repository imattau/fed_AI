import type { RouterFederationConfig } from '../config';
import type { RouterControlMessage } from '@fed-ai/protocol';

export type FederationRateLimiter = {
  allow: (peerId: string, type: RouterControlMessage<unknown>['type']) => boolean;
};

type RateLimitBucket = {
  windowStartMs: number;
  count: number;
};

export const createFederationRateLimiter = (
  config?: RouterFederationConfig,
): FederationRateLimiter => {
  const max = config?.rateLimitMax ?? 0;
  const windowMs = config?.rateLimitWindowMs ?? 0;
  if (max <= 0 || windowMs <= 0) {
    return { allow: () => true };
  }

  const buckets = new Map<string, RateLimitBucket>();

  const allow = (peerId: string, type: RouterControlMessage<unknown>['type']): boolean => {
    const key = `${peerId}:${type}`;
    const now = Date.now();
    const existing = buckets.get(key);
    if (!existing || now - existing.windowStartMs >= windowMs) {
      buckets.set(key, { windowStartMs: now, count: 1 });
      return true;
    }
    if (existing.count >= max) {
      return false;
    }
    existing.count += 1;
    return true;
  };

  return { allow };
};
