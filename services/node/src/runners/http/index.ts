import type { InferenceRequest, InferenceResponse, ModelInfo } from '@fed-ai/protocol';
import type { Runner, RunnerEstimate, RunnerHealth } from '../types';

type HttpRunnerOptions = {
  baseUrl: string;
  defaultModelId?: string;
  timeoutMs?: number;
};

type ModelListResponse = {
  models: ModelInfo[];
};

type InferResponse = {
  output: string;
  usage: InferenceResponse['usage'];
  latencyMs: number;
  requestId: string;
  modelId: string;
};

export class HttpRunner implements Runner {
  private baseUrl: string;
  private defaultModelId: string;
  private timeoutMs?: number;

  constructor(options: HttpRunnerOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.defaultModelId = options.defaultModelId ?? 'llama-model';
    this.timeoutMs = options.timeoutMs;
  }

  private buildUrl(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private async fetchJson<T>(path: string, init: RequestInit): Promise<T> {
    const controller = this.timeoutMs ? new AbortController() : null;
    const timeout = this.timeoutMs
      ? setTimeout(() => controller?.abort(), this.timeoutMs)
      : null;
    const response = await fetch(this.buildUrl(path), {
      ...init,
      signal: controller?.signal,
      headers: {
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    }).finally(() => {
      if (timeout) {
        clearTimeout(timeout);
      }
    });

    if (!response.ok) {
      throw new Error(`runner-http ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  }

  async listModels(): Promise<ModelInfo[]> {
    const payload = await this.fetchJson<ModelListResponse>('/models', {
      method: 'GET',
    });
    if (!payload.models || payload.models.length === 0) {
    return [
      {
        id: this.defaultModelId,
        contextWindow: 4096,
      },
    ];
    }
    return payload.models;
  }

  async infer(request: InferenceRequest): Promise<InferenceResponse> {
    const payload = await this.fetchJson<InferResponse>('/infer', {
      method: 'POST',
      body: JSON.stringify(request),
    });

    return {
      requestId: payload.requestId,
      modelId: payload.modelId,
      output: payload.output,
      usage: payload.usage,
      latencyMs: payload.latencyMs,
    };
  }

  async estimate(_request: InferenceRequest): Promise<RunnerEstimate> {
    try {
      const payload = await this.fetchJson<{ costEstimate: number; latencyEstimateMs: number }>('/estimate', {
        method: 'POST',
        body: JSON.stringify(_request),
      });
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
