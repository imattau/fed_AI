import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import si from 'systeminformation';
import type { BenchOptions, BenchResult } from './types';

const runCpuBench = (): number => {
  const iterations = 5_000_000;
  const start = process.hrtime.bigint();
  let acc = 0;
  for (let i = 0; i < iterations; i += 1) {
    acc += (i * 31) % 97;
  }
  const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
  return Math.round((iterations / durationMs) * 1000 + acc * 0.000001);
};

const runMemoryBench = (): number => {
  const size = 64 * 1024 * 1024;
  const src = Buffer.alloc(size, 1);
  const dest = Buffer.alloc(size, 0);
  const start = process.hrtime.bigint();
  src.copy(dest);
  const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
  return Math.round((size / (1024 * 1024)) / (durationMs / 1000));
};

const runDiskBench = async (): Promise<number> => {
  const size = 8 * 1024 * 1024;
  const buffer = Buffer.alloc(size, 7);
  const filePath = path.join(tmpdir(), `fedai-bench-${process.pid}.bin`);
  const start = process.hrtime.bigint();
  await fs.writeFile(filePath, buffer);
  await fs.readFile(filePath);
  const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
  await fs.unlink(filePath);
  return Math.round((size / (1024 * 1024)) / (durationMs / 1000));
};

const runNetworkBench = async (targets: string[]): Promise<number | undefined> => {
  if (targets.length === 0) {
    return undefined;
  }
  const samples: number[] = [];
  for (const target of targets.slice(0, 3)) {
    const value = await si.inetLatency(target);
    if (Number.isFinite(value)) {
      samples.push(value);
    }
  }
  if (samples.length === 0) {
    return undefined;
  }
  return Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length);
};

export const runBench = async (options: BenchOptions): Promise<BenchResult> => {
  const cpuScore = runCpuBench();
  const memoryMBps = runMemoryBench();
  const diskMBps = await runDiskBench();
  const networkLatencyMs = await runNetworkBench(options.latencyTargets ?? []);

  return {
    cpuScore,
    memoryMBps,
    diskMBps,
    networkLatencyMs,
    timestampMs: Date.now(),
  };
};

export type { BenchOptions, BenchResult, BenchMode } from './types';
