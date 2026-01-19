import { z } from 'zod';

export const adminConfigUpdateSchema = z.object({
  // Common
  logLevel: z.string().optional(),
  
  // Node specific
  capacityMaxConcurrent: z.number().optional(),
  maxTokens: z.number().optional(),
  
  // Router specific
  routerFeeBps: z.number().optional(),
  clientBlockList: z.array(z.string()).optional(),
  federationPeers: z.array(z.string()).optional(),
});

export type AdminConfigUpdate = z.infer<typeof adminConfigUpdateSchema>;

export const adminModelDownloadSchema = z.object({
  modelId: z.string(), // HF Repo ID e.g. "Bartowski/Meta-Llama-3.1-8B-Instruct-GGUF"
  filename: z.string(), // Specific GGUF file
  quantization: z.string().optional(), // e.g. "Q4_K_M" (informational or selector)
});

export type AdminModelDownloadRequest = z.infer<typeof adminModelDownloadSchema>;

export const adminStatusSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  mode: z.enum(['node', 'router']),
  uptime: z.number(),
  config: z.record(z.unknown()), // Safe subset of config
});

export type AdminStatusResponse = z.infer<typeof adminStatusSchema>;
