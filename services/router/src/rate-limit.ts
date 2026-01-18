type Counter = { count: number; resetAt: number };

export type RateLimiter = {
  allow: (key: string) => boolean;
};

export const createRateLimiter = (
  max: number | undefined,
  windowMs: number | undefined,
): RateLimiter | null => {
  if (!max || max <= 0 || !windowMs || windowMs <= 0) {
    return null;
  }

  const counters = new Map<string, Counter>();

  const allow = (key: string): boolean => {
    const now = Date.now();
    const existing = counters.get(key);
    if (!existing || existing.resetAt <= now) {
      counters.set(key, { count: 1, resetAt: now + windowMs });
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
