import type { InferenceRequest, InferenceResponse, ModelInfo } from '@fed-ai/protocol';
import type { Runner, RunnerEstimate, RunnerHealth } from '../types';

const DEFAULT_MODEL: ModelInfo = {
  id: 'cpu-stats',
  family: 'cpu',
  version: 'v1',
  contextWindow: 8192,
};

const tokenize = (text: string): string[] => {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
};

const topTerms = (tokens: string[], limit = 5): Array<{ term: string; count: number }> => {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
};

export class CpuStatsRunner implements Runner {
  private model: ModelInfo;

  constructor(modelId?: string) {
    this.model = {
      ...DEFAULT_MODEL,
      id: modelId ?? DEFAULT_MODEL.id,
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [this.model];
  }

  async infer(request: InferenceRequest): Promise<InferenceResponse> {
    // Provide deterministic CPU-only analysis of the prompt.
    const tokens = tokenize(request.prompt);
    const response = {
      model: this.model.id,
      chars: request.prompt.length,
      words: tokens.length,
      topTerms: topTerms(tokens),
    };
    const output = JSON.stringify(response, null, 2);
    return {
      requestId: request.requestId,
      modelId: this.model.id,
      output,
      usage: {
        inputTokens: Math.max(1, Math.floor(request.prompt.length / 4)),
        outputTokens: Math.min(request.maxTokens, Math.ceil(output.length / 4)),
      },
      latencyMs: 5,
    };
  }

  async estimate(_request: InferenceRequest): Promise<RunnerEstimate> {
    return {
      costEstimate: 0,
      latencyEstimateMs: 5,
    };
  }

  async health(): Promise<RunnerHealth> {
    return { ok: true };
  }
}
