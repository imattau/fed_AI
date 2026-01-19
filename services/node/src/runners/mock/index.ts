import { estimateTokensFromText } from '@fed-ai/protocol';
import type { InferenceRequest, InferenceResponse, ModelInfo } from '@fed-ai/protocol';
import type { Runner, RunnerEstimate, RunnerHealth } from '../types';

export class MockRunner implements Runner {
  async listModels(): Promise<ModelInfo[]> {
    return [
      { id: 'mock-chat', contextWindow: 4096 },
      { id: 'mock-video', contextWindow: 1000 },
      { id: 'mock-audio', contextWindow: 1000 },
    ];
  }

  async infer(request: InferenceRequest): Promise<InferenceResponse> {
    let output = '';
    const model = request.modelId.toLowerCase();

    if (model.includes('video')) {
      output = JSON.stringify({
        url: 'https://cdn.fed-ai.net/generated/video/123.mp4',
        duration: 15,
        format: 'mp4',
        status: 'completed'
      });
    } else if (model.includes('audio')) {
      output = JSON.stringify({
        url: 'https://cdn.fed-ai.net/generated/audio/456.mp3',
        duration: 45,
        format: 'mp3',
        transcript: 'This is a simulated audio generation.'
      });
    } else {
      // Chat simulation
      output = `[Mock Response] I received your prompt: "${request.prompt}". This is a simulated text response.`;
    }

    return {
      requestId: request.requestId,
      modelId: request.modelId,
      output,
      usage: {
        inputTokens: estimateTokensFromText(request.prompt),
        outputTokens: estimateTokensFromText(output),
      },
      latencyMs: 100,
    };
  }

  async estimate(_request: InferenceRequest): Promise<RunnerEstimate> {
    return {
      latencyEstimateMs: 100,
      costEstimate: 0,
    };
  }

  async health(): Promise<RunnerHealth> {
    return { ok: true };
  }
}
