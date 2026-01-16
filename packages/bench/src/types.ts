export type BenchMode = 'node' | 'router';

export type BenchOptions = {
  mode: BenchMode;
  maxSeconds?: number;
  latencyTargets?: string[];
};

export type BenchResult = {
  cpuScore: number;
  memoryMBps: number;
  diskMBps: number;
  networkLatencyMs?: number;
  timestampMs: number;
};
