import { estimateTokensFromText } from '@fed-ai/protocol';
import type { InferenceRequest, InferenceResponse, ModelInfo } from '@fed-ai/protocol';
import type { Runner, RunnerEstimate, RunnerHealth, RunnerStreamChunk } from '../../src/runners/types';

const DEFAULT_MODEL: ModelInfo = {
  id: 'mock-model',
  family: 'mock',
  version: 'v0',
  contextWindow: 4096,
};

type MockRunnerOptions = {
  modelId?: string;
};

export class MockRunner implements Runner {
  private model: ModelInfo;

  constructor(options: MockRunnerOptions = {}) {
    const modelId = options.modelId ?? DEFAULT_MODEL.id;
    this.model = {
      ...DEFAULT_MODEL,
      id: modelId,
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [this.model];
  }

  async infer(request: InferenceRequest): Promise<InferenceResponse> {
    return {
      requestId: request.requestId,
      modelId: request.modelId,
      output: `mock-response:${request.prompt.slice(0, 32)}`,
      usage: {
        inputTokens: estimateTokensFromText(request.prompt),
        outputTokens: Math.min(request.maxTokens, 16),
      },
      latencyMs: 10,
    };
  }

  async *inferStream(request: InferenceRequest): AsyncIterable<RunnerStreamChunk> {
    const output = `mock-response:${request.prompt.slice(0, 32)}`;
    const midpoint = Math.max(1, Math.floor(output.length / 2));
    yield { delta: output.slice(0, midpoint) };
    yield { delta: output.slice(midpoint) };
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
