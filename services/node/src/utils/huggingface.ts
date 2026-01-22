import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export type HFModelFile = {
  path: string;
  sizeBytes: number;
  downloadUrl: string;
  tags?: string[];
};

export const searchGGUF = async (modelId: string, token?: string): Promise<HFModelFile[]> => {
  const url = `https://huggingface.co/api/models/${modelId}/tree/main?recursive=true`;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  
  const res = await fetch(url, { headers });
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`Failed to fetch model tree: ${res.statusText}`);
  }

  const files = (await res.json()) as any[];
  
  return files
    .filter((f: any) => f.path.endsWith('.gguf'))
    .map((f: any) => ({
      path: f.path,
      sizeBytes: f.size,
      downloadUrl: `https://huggingface.co/${modelId}/resolve/main/${f.path}`,
    }))
    .sort((a: any, b: any) => a.sizeBytes - b.sizeBytes);
};

export type HFModel = {
  id: string;
  likes: number;
  downloads: number;
};

export const searchModels = async (query: string, token?: string): Promise<HFModel[]> => {
  const url = `https://huggingface.co/api/models?search=${encodeURIComponent(query)}&filter=gguf&sort=likes&direction=-1&limit=10`;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Failed to search models: ${res.statusText}`);
  
  const models = (await res.json()) as any[];
  return models.map((m: any) => ({
    id: m.modelId || m.id,
    likes: m.likes,
    downloads: m.downloads,
  }));
};

export type DownloadProgress = {
  total: number;
  current: number;
  percent: number;
};

export const downloadModelFile = async (
  url: string,
  destDir: string,
  filename: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<string> => {
  await mkdir(destDir, { recursive: true });
  const destPath = path.join(destDir, filename);
  
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Failed to download: ${res.statusText}`);

  const total = Number(res.headers.get('content-length') ?? 0);
  let current = 0;

  // We need to use a Transform stream or just monitor the chunks if we use pipeline
  // But pipeline with fetch body (Web Stream) -> fs (Node Stream) requires conversion or Node 18+ support.
  // We'll manual pump for progress tracking.
  
  const fileStream = createWriteStream(destPath);
  const reader = res.body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        current += value.length;
        fileStream.write(value);
        if (onProgress && total > 0) {
          onProgress({ total, current, percent: (current / total) * 100 });
        }
      }
    }
  } finally {
    fileStream.end();
  }

  return destPath;
};
