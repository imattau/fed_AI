import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

export type HFModelFile = {
  path: string;
  sizeBytes: number;
  downloadUrl: string;
  tags?: string[];
};

export const searchGGUF = async (modelId: string): Promise<HFModelFile[]> => {
  const url = `https://huggingface.co/api/models/${modelId}/tree/main?recursive=true`;
  const res = await fetch(url);
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
    .sort((a, b) => a.sizeBytes - b.sizeBytes); // Smallest first
};

export const recommendQuantization = (files: HFModelFile[], vramGb: number, ramGb: number): HFModelFile | null => {
  // Rough estimate: Model size in GB must be < Available VRAM (for GPU offload) or RAM
  // Leave 2GB headroom for OS/System
  const availableGb = Math.max(vramGb, ramGb - 2); 
  
  // Prefer Q4_K_M or Q5_K_M if possible
  const preferred = files.find(f => 
    (f.path.includes('Q4_K_M') || f.path.includes('Q5_K_M')) && 
    (f.sizeBytes / 1024 / 1024 / 1024) < availableGb
  );

  if (preferred) return preferred;

  // Fallback: largest one that fits
  const fitting = files.filter(f => (f.sizeBytes / 1024 / 1024 / 1024) < availableGb);
  return fitting.pop() || null; // Return largest that fits
};

export const downloadFile = async (url: string, destPath: string, sizeBytes: number): Promise<void> => {
  console.log(`Downloading ${url} to ${destPath}...`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Failed to download: ${res.statusText}`);

  const fileStream = createWriteStream(destPath);
  let downloaded = 0;
  
  // Create a tracking stream or hook into data events
  // Since we use pipeline with native fetch stream (ReadableStream), we need to transform it to Node stream or iterate
  // Node 18+ fetch returns a web stream. pipeline supports it.
  
  // Simple progress logger
  const reader = res.body.getReader();
  const writer = fileStream;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    downloaded += value.length;
    writer.write(value);
    
    // Log progress every ~10MB or so? Or just throttle log
    if (Math.random() < 0.01) { // Basic sampling to avoid console spam
        const pct = ((downloaded / sizeBytes) * 100).toFixed(1);
        process.stdout.write(`\rProgress: ${pct}% (${(downloaded / 1024 / 1024).toFixed(0)} MB)`);
    }
  }
  writer.end();
  console.log('\nDownload complete.');
};
