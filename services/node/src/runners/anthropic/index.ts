import { estimateTokensFromText } from '@fed-ai/protocol';
import type { InferenceRequest, InferenceResponse, ModelInfo } from '@fed-ai/protocol';
import type { Runner, RunnerEstimate, RunnerHealth } from '../types';

type AnthropicRunnerOptions = {
  baseUrl: string;
  defaultModelId?: string;
  timeoutMs?: number;
  apiKey?: string;
};

type AnthropicResponse = {
  content?: Array<{ text?: string }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
};

export class AnthropicRunner implements Runner {
  private baseUrl: string;
  private defaultModelId: string;
  private timeoutMs?: number;
  private apiKey?: string;

  constructor(options: AnthropicRunnerOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.defaultModelId = options.defaultModelId ?? 'claude-3-haiku-20240307';
    this.timeoutMs = options.timeoutMs;
    this.apiKey = options.apiKey;
  }

  private buildUrl(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private buildHeaders(extra?: HeadersInit): HeadersInit {
    return {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
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
      throw new Error(`runner-anthropic ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      {
        id: this.defaultModelId,
        contextWindow: 4096,
      },
    ];
  }

  async infer(request: InferenceRequest): Promise<InferenceResponse> {
    const payload = await this.fetchJson<AnthropicResponse>('/v1/messages', {
      method: 'POST',
      body: JSON.stringify({
        model: request.modelId ?? this.defaultModelId,
        max_tokens: request.maxTokens,
        messages: [{ role: 'user', content: request.prompt }],
      }),
    });

    const output = payload.content?.[0]?.text ?? '';
    return {
      requestId: request.requestId,
      modelId: request.modelId ?? this.defaultModelId,
      output,
      usage: {
        inputTokens: payload.usage?.input_tokens ?? estimateTokensFromText(request.prompt),
        outputTokens: payload.usage?.output_tokens ?? estimateTokensFromText(output),
      },
      latencyMs: 0,
    };
  }

  async estimate(_request: InferenceRequest): Promise<RunnerEstimate> {
    return { latencyEstimateMs: 50 };
  }

  async health(): Promise<RunnerHealth> {
    try {
      const controller = this.timeoutMs ? new AbortController() : null;
      const timeout = this.timeoutMs
        ? setTimeout(() => controller?.abort(), this.timeoutMs)
        : null;
      const response = await fetch(this.buildUrl('/v1/models'), {
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
