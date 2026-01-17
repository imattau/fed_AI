import type { InferenceRequest, InferenceResponse, ModelInfo } from '@fed-ai/protocol';
import type { Runner, RunnerEstimate, RunnerHealth } from '../types';

type OpenAiRunnerOptions = {
  baseUrl: string;
  defaultModelId?: string;
  timeoutMs?: number;
  apiKey?: string;
  mode?: 'chat' | 'completion';
};

type OpenAiModelsResponse = {
  data?: Array<{ id: string }>;
};

type OpenAiCompletionResponse = {
  choices?: Array<{ text?: string }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
};

type OpenAiChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
};

export class OpenAiRunner implements Runner {
  private baseUrl: string;
  private defaultModelId: string;
  private timeoutMs?: number;
  private apiKey?: string;
  private mode: 'chat' | 'completion';

  constructor(options: OpenAiRunnerOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.defaultModelId = options.defaultModelId ?? 'gpt-4o-mini';
    this.timeoutMs = options.timeoutMs;
    this.apiKey = options.apiKey;
    this.mode = options.mode ?? 'chat';
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
      throw new Error(`runner-openai ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const payload = await this.fetchJson<OpenAiModelsResponse>('/v1/models', { method: 'GET' });
      if (payload.data && payload.data.length > 0) {
        return payload.data.map((entry) => ({
          id: entry.id,
          contextWindow: 4096,
        }));
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
    if (this.mode === 'completion') {
      const payload = await this.fetchJson<OpenAiCompletionResponse>('/v1/completions', {
        method: 'POST',
        body: JSON.stringify({
          model: request.modelId ?? this.defaultModelId,
          prompt: request.prompt,
          max_tokens: request.maxTokens,
          temperature: request.temperature ?? 0.7,
          top_p: request.topP ?? 0.95,
        }),
      });

      const output = payload.choices?.[0]?.text ?? '';
      return {
        requestId: request.requestId,
        modelId: request.modelId ?? this.defaultModelId,
        output,
        usage: {
          inputTokens: payload.usage?.prompt_tokens ?? request.prompt.length,
          outputTokens: payload.usage?.completion_tokens ?? output.length,
        },
        latencyMs: 0,
      };
    }

    const payload = await this.fetchJson<OpenAiChatResponse>('/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: request.modelId ?? this.defaultModelId,
        messages: [{ role: 'user', content: request.prompt }],
        max_tokens: request.maxTokens,
        temperature: request.temperature ?? 0.7,
        top_p: request.topP ?? 0.95,
      }),
    });

    const output = payload.choices?.[0]?.message?.content ?? '';
    return {
      requestId: request.requestId,
      modelId: request.modelId ?? this.defaultModelId,
      output,
      usage: {
        inputTokens: payload.usage?.prompt_tokens ?? request.prompt.length,
        outputTokens: payload.usage?.completion_tokens ?? output.length,
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
