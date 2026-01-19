import { Worker } from 'node:worker_threads';
import path from 'node:path';
import os from 'node:os';
import type {
  EnvelopeWorkerResult,
  EnvelopeWorkerTask,
  EnvelopeValidatorName,
} from './types';

type QueueEntry = {
  task: EnvelopeWorkerTask;
  resolve: (value: EnvelopeWorkerResult) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
};

type WorkerSlot = {
  worker: Worker;
  busy: boolean;
};

export type EnvelopeWorkerPoolOptions = {
  maxWorkers?: number;
  maxQueue?: number;
  taskTimeoutMs?: number;
};

export type EnvelopeWorkerPool = {
  validateAndVerify: (payload: {
    envelope: unknown;
    validator: EnvelopeValidatorName;
    keyId?: string;
    publicKeyHex?: string;
  }) => Promise<EnvelopeWorkerResult>;
};

const resolveWorkerPath = (): { path: string; execArgv: string[] } => {
  const isTypeScript = __filename.endsWith('.ts');
  const workerFile = isTypeScript ? 'envelope-worker.ts' : 'envelope-worker.js';
  const workerPath = path.join(__dirname, workerFile);
  const execArgv = isTypeScript ? ['--require', 'tsx/cjs'] : [];
  return { path: workerPath, execArgv };
};

export const createEnvelopeWorkerPool = (
  options: EnvelopeWorkerPoolOptions = {},
): EnvelopeWorkerPool => {
  const maxWorkers = options.maxWorkers ?? Math.max(1, Math.min(os.cpus().length, 8));
  const maxQueue = options.maxQueue ?? 500;
  const taskTimeoutMs = options.taskTimeoutMs ?? 2000;
  const { path: workerPath, execArgv } = resolveWorkerPath();
  let nextId = 1;
  const queue: QueueEntry[] = [];
  const workers: WorkerSlot[] = [];

  const dispatch = (): void => {
    const idle = workers.find((slot) => !slot.busy);
    if (!idle) {
      return;
    }
    const entry = queue.shift();
    if (!entry) {
      return;
    }
    idle.busy = true;
    idle.worker.postMessage(entry.task);
    const timeout = setTimeout(() => {
      cleanup();
      entry.reject(new Error('worker-timeout'));
    }, taskTimeoutMs);
    entry.timer = timeout;
    const onMessage = (result: EnvelopeWorkerResult) => {
      cleanup();
      entry.resolve(result);
    };
    const onError = (error: Error) => {
      cleanup();
      entry.reject(error);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      idle.busy = false;
      idle.worker.off('message', onMessage);
      idle.worker.off('error', onError);
      dispatch();
    };
    idle.worker.on('message', onMessage);
    idle.worker.on('error', onError);
  };

  for (let i = 0; i < maxWorkers; i += 1) {
    const worker = new Worker(workerPath, { execArgv });
    worker.unref();
    workers.push({ worker, busy: false });
  }

  const validateAndVerify = (payload: {
    envelope: unknown;
    validator: EnvelopeValidatorName;
    keyId?: string;
    publicKeyHex?: string;
  }): Promise<EnvelopeWorkerResult> => {
    if (queue.length >= maxQueue) {
      return Promise.resolve({ id: 0, ok: false, error: 'worker-error', details: 'queue-full' });
    }
    const task: EnvelopeWorkerTask = {
      id: nextId,
      type: 'validateAndVerify',
      payload,
    };
    nextId += 1;
    return new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      dispatch();
    });
  };

  return { validateAndVerify };
};
