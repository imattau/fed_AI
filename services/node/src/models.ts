export type ModelLimit = {
  maxTokens: number; // Context window
};

export const KNOWN_LIMITS: Record<string, ModelLimit> = {
  // Groq / Meta Llama
  'llama-3.1-8b-instant': { maxTokens: 131072 },
  'llama-3.1-70b-versatile': { maxTokens: 131072 },
  'llama-3.1-405b-reasoning': { maxTokens: 131072 },
  'llama-3.1-8b-instruct': { maxTokens: 128000 },
  'llama-3.1-70b-instruct': { maxTokens: 128000 },
  'llama-3.1-405b-instruct': { maxTokens: 128000 },
  'llama-3-8b-instruct': { maxTokens: 8192 },
  'llama-3-70b-instruct': { maxTokens: 8192 },
  'llama3-8b-8192': { maxTokens: 8192 },
  'llama3-70b-8192': { maxTokens: 8192 },
  
  // Mistral
  'mixtral-8x7b-32768': { maxTokens: 32768 },
  'mistral-7b-instruct': { maxTokens: 32768 },

  // Google Gemma
  'gemma-7b-it': { maxTokens: 8192 },
  'gemma2-9b-it': { maxTokens: 8192 },
  'gemma2-27b-it': { maxTokens: 8192 },

  // OpenAI
  'gpt-4o': { maxTokens: 128000 },
  'gpt-4o-mini': { maxTokens: 128000 },
  'gpt-4-turbo': { maxTokens: 128000 },
  'gpt-3.5-turbo': { maxTokens: 16385 },
};

export const resolveModelLimit = (modelId: string, fallback: number = 4096): number => {
  // Exact match
  if (KNOWN_LIMITS[modelId]) {
    return KNOWN_LIMITS[modelId].maxTokens;
  }

  // Fuzzy match for common patterns
  const lower = modelId.toLowerCase();
  if (lower.includes('llama-3.1') || lower.includes('llama-3_1')) {
    return 128000;
  }
  if (lower.includes('llama-3') || lower.includes('llama-3')) {
    return 8192;
  }
  if (lower.includes('mistral') || lower.includes('mixtral')) {
    return 32768;
  }

  return fallback;
};
