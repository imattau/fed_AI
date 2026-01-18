type RetryConfig = {
  retryMaxAttempts?: number;
  retryMinDelayMs?: number;
  retryMaxDelayMs?: number;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const resolveRetryConfig = (config?: RetryConfig) => {
  const maxAttempts = Math.max(1, config?.retryMaxAttempts ?? 1);
  const minDelayMs = Math.max(0, config?.retryMinDelayMs ?? 100);
  const maxDelayMs = Math.max(minDelayMs, config?.retryMaxDelayMs ?? 1_000);
  return { maxAttempts, minDelayMs, maxDelayMs };
};

const nextDelayMs = (attempt: number, minDelayMs: number, maxDelayMs: number) => {
  const base = Math.min(maxDelayMs, minDelayMs * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * Math.min(50, minDelayMs));
  return Math.min(maxDelayMs, base + jitter);
};

export const withRetry = async <T>(
  work: (attempt: number) => Promise<T>,
  config?: RetryConfig,
): Promise<T> => {
  const { maxAttempts, minDelayMs, maxDelayMs } = resolveRetryConfig(config);
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await work(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) {
        throw error;
      }
      const delay = nextDelayMs(attempt, minDelayMs, maxDelayMs);
      await sleep(delay);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('retry-failed');
};
