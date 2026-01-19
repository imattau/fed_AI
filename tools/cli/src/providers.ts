export type ModelLimit = {
  maxTokens: number; // Context window
  maxOutput?: number; // Max output tokens if known
};

export const KNOWN_LIMITS: Record<string, ModelLimit> = {
  // Groq Models
  'llama-3.1-8b-instant': { maxTokens: 131072 },
  'llama-3.1-70b-versatile': { maxTokens: 131072 },
  'llama-3.1-405b-reasoning': { maxTokens: 131072 },
  'llama3-8b-8192': { maxTokens: 8192 },
  'llama3-70b-8192': { maxTokens: 8192 },
  'mixtral-8x7b-32768': { maxTokens: 32768 },
  'gemma-7b-it': { maxTokens: 8192 },
  'gemma2-9b-it': { maxTokens: 8192 },

  // OpenAI Models
  'gpt-4o': { maxTokens: 128000 },
  'gpt-4o-mini': { maxTokens: 128000 },
  'gpt-4-turbo': { maxTokens: 128000 },
  'gpt-3.5-turbo': { maxTokens: 16385 },
};

export type ProviderConfig = {
  name: string;
  baseUrl: string;
  apiKeyEnv: string;
  defaultModel?: string;
};

export const PROVIDERS: Record<string, ProviderConfig> = {
  groq: {
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'NODE_OPENAI_API_KEY', // We might use specific env vars later but node uses this for now if generic
    defaultModel: 'llama-3.1-8b-instant',
  },
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'NODE_OPENAI_API_KEY',
    defaultModel: 'gpt-4o-mini',
  },
};

export type ModelInfo = {
  id: string;
  owned_by: string;
};

export const fetchModels = async (baseUrl: string, apiKey: string): Promise<string[]> => {
  try {
    const url = `${baseUrl.replace(/\/$/, '')}/models`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { data: ModelInfo[] };
    return data.data.map((m) => m.id).sort();
  } catch (error) {
    throw new Error(`Error fetching models from ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
  }
};
