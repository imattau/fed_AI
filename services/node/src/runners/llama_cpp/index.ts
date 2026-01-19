import { estimateTokensFromText } from '@fed-ai/protocol';
import type { InferenceRequest, InferenceResponse, ModelInfo } from '@fed-ai/protocol';
import type { Runner, RunnerEstimate, RunnerHealth } from '../types';

type LlamaCppRunnerOptions = {
  baseUrl: string;
  defaultModelId?: string;
  timeoutMs?: number;
  apiKey?: string;
};

type ModelListResponse = {
  models?: ModelInfo[];
};

type LlamaCompletionResponse = {
  content?: string;
  completion?: string;
  choices?: Array<{ text?: string }>;
  prompt_eval_count?: number;
  eval_count?: number;
  tokens_predicted?: number;
  tokens_evaluated?: number;
  timings?: { total_ms?: number };
};

export class LlamaCppRunner implements Runner {
  private baseUrl: string;
  private defaultModelId: string;
  private timeoutMs?: number;
  private apiKey?: string;

  constructor(options: LlamaCppRunnerOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.defaultModelId = options.defaultModelId ?? 'llama-model';
    this.timeoutMs = options.timeoutMs;
    this.apiKey = options.apiKey;
  }

  private buildUrl(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private buildHeaders(extra?: HeadersInit): HeadersInit {
    return {
      'content-type': 'application/json',
      ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      ...(extra ?? {}),
    };
  }

  private async fetchJson<T>(path: string, init: RequestInit): Promise<T> {
    const controller = this.timeoutMs ? new AbortController() : null;
    const timeout = this.timeoutMs
      ? setTimeout(() => controller?.abort(), this.timeoutMs)
      : null;
    const response = await fetch(this.buildUrl(path), {
      ...init,
      signal: controller?.signal,
      headers: this.buildHeaders(init.headers),
    }).finally(() => {
      if (timeout) {
        clearTimeout(timeout);
      }
    });

    if (!response.ok) {
      throw new Error(`runner-llama-cpp ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const payload = await this.fetchJson<ModelListResponse>('/models', { method: 'GET' });
      if (payload.models && payload.models.length > 0) {
        return payload.models;
      }
    } catch {
      // fall back to defaults when models endpoint is unavailable
    }
    return [
      {
        id: this.defaultModelId,
        contextWindow: 4096,
      },
    ];
  }

  async infer(request: InferenceRequest): Promise<InferenceResponse> {
    const payload = await this.fetchJson<LlamaCompletionResponse>('/completion', {
      method: 'POST',
      body: JSON.stringify({
        prompt: request.prompt,
        n_predict: request.maxTokens,
        temperature: request.temperature ?? 0.7,
        top_p: request.topP ?? 0.95,
      }),
    });

    const output =
      payload.content ??
      payload.completion ??
      payload.choices?.[0]?.text ??
      '';
    const inputTokens =
      payload.prompt_eval_count ?? payload.tokens_evaluated ?? estimateTokensFromText(request.prompt);
    const outputTokens =
      payload.eval_count ?? payload.tokens_predicted ?? estimateTokensFromText(output);
    const latencyMs = payload.timings?.total_ms ?? 0;

    return {
      requestId: request.requestId,
      modelId: request.modelId ?? this.defaultModelId,
      output,
      usage: {
        inputTokens,
        outputTokens,
      },
      latencyMs,
    };
  }

  async estimate(_request: InferenceRequest): Promise<RunnerEstimate> {
    try {
      const payload = await this.fetchJson<{ costEstimate?: number; latencyEstimateMs?: number }>(
        '/estimate',
        {
          method: 'POST',
          body: JSON.stringify(_request),
        },
      );
      return {
        costEstimate: payload.costEstimate,
        latencyEstimateMs: payload.latencyEstimateMs,
      };
    } catch {
      return { latencyEstimateMs: 50 };
    }
  }

  async health(): Promise<RunnerHealth> {
    try {
      const controller = this.timeoutMs ? new AbortController() : null;
      const timeout = this.timeoutMs
        ? setTimeout(() => controller?.abort(), this.timeoutMs)
        : null;
      const response = await fetch(this.buildUrl('/health'), {
        method: 'GET',
        signal: controller?.signal,
        headers: this.buildHeaders(),
      }).finally(() => {
        if (timeout) {
          clearTimeout(timeout);
        }
      });
      return { ok: response.ok };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }
}
