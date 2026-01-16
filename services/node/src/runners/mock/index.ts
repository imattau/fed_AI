import type { InferenceRequest, InferenceResponse, ModelInfo } from '@fed-ai/protocol';
import type { Runner, RunnerEstimate, RunnerHealth } from '../types';

const DEFAULT_MODEL: ModelInfo = {
  id: 'mock-model',
  family: 'mock',
  version: 'v0',
  contextWindow: 4096,
};

export class MockRunner implements Runner {
  async listModels(): Promise<ModelInfo[]> {
    return [DEFAULT_MODEL];
  }

  async infer(request: InferenceRequest): Promise<InferenceResponse> {
    return {
      requestId: request.requestId,
      modelId: request.modelId,
      output: `mock-response:${request.prompt.slice(0, 32)}`,
      usage: {
        inputTokens: Math.max(1, Math.floor(request.prompt.length / 4)),
        outputTokens: Math.min(request.maxTokens, 16),
      },
      latencyMs: 10,
    };
  }

  async estimate(_request: InferenceRequest): Promise<RunnerEstimate> {
    return {
      costEstimate: 0,
      latencyEstimateMs: 10,
    };
  }

  async health(): Promise<RunnerHealth> {
    return { ok: true };
  }
}
