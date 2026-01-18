export type FederationRelayManager = {
  relays: string[];
  getActiveRelays: () => string[];
  recordFailure: (relay: string) => void;
  recordSuccess: (relay: string) => void;
  nextRetryDelayMs: () => number | null;
};

type RelayState = {
  failures: number;
  nextAttemptAtMs: number;
};

export const createFederationRelayManager = (
  relays: string[],
  minRetryMs: number,
  maxRetryMs: number,
): FederationRelayManager => {
  const state = new Map<string, RelayState>();
  const minDelay = Math.max(250, minRetryMs);
  const maxDelay = Math.max(minDelay, maxRetryMs);

  const getState = (relay: string): RelayState => {
    const existing = state.get(relay);
    if (existing) {
      return existing;
    }
    const entry = { failures: 0, nextAttemptAtMs: 0 };
    state.set(relay, entry);
    return entry;
  };

  const getActiveRelays = (): string[] => {
    const now = Date.now();
    return relays.filter((relay) => {
      const entry = getState(relay);
      return entry.nextAttemptAtMs <= now;
    });
  };

  const recordFailure = (relay: string): void => {
    const entry = getState(relay);
    entry.failures += 1;
    const backoff = Math.min(maxDelay, minDelay * 2 ** Math.max(0, entry.failures - 1));
    entry.nextAttemptAtMs = Date.now() + backoff;
  };

  const recordSuccess = (relay: string): void => {
    const entry = getState(relay);
    entry.failures = 0;
    entry.nextAttemptAtMs = 0;
  };

  const nextRetryDelayMs = (): number | null => {
    const now = Date.now();
    let next: number | null = null;
    for (const relay of relays) {
      const entry = getState(relay);
      if (entry.nextAttemptAtMs <= now) {
        return 0;
      }
      const delay = entry.nextAttemptAtMs - now;
      if (next === null || delay < next) {
        next = delay;
      }
    }
    return next;
  };

  return {
    relays,
    getActiveRelays,
    recordFailure,
    recordSuccess,
    nextRetryDelayMs,
  };
};
