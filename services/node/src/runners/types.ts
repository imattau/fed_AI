import type { InferenceRequest, InferenceResponse, ModelInfo } from '@fed-ai/protocol';

export type RunnerEstimate = {
  costEstimate?: number;
  latencyEstimateMs?: number;
};

export type RunnerHealth = {
  ok: boolean;
  detail?: string;
};

export type RunnerStreamChunk = {
  delta: string;
};

export interface Runner {
  listModels(): Promise<ModelInfo[]>;
  infer(request: InferenceRequest): Promise<InferenceResponse>;
  inferStream?(request: InferenceRequest): AsyncIterable<RunnerStreamChunk>;
  estimate(request: InferenceRequest): Promise<RunnerEstimate>;
  health(): Promise<RunnerHealth>;
}
