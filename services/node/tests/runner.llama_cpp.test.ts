import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { AddressInfo } from 'node:net';

const startLlamaServer = async () => {
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks).toString('utf8');

    if (req.url === '/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ models: [{ id: 'llama-test', contextWindow: 2048 }] }));
      return;
    }

    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.url === '/completion') {
      const payload = JSON.parse(body) as { prompt: string };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          content: `echo:${payload.prompt}`,
          prompt_eval_count: 3,
          eval_count: 2,
          timings: { total_ms: 12 },
        }),
      );
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
};

test('llama.cpp runner proxies to completion endpoint', async () => {
  const { LlamaCppRunner } = (await import(
    path.join(process.cwd(), 'src/runners/llama_cpp/index.ts'),
  )) as typeof import('../../src/runners/llama_cpp/index');
  const { server, baseUrl } = await startLlamaServer();
  const runner = new LlamaCppRunner({ baseUrl, defaultModelId: 'llama-test' });

  const models = await runner.listModels();
  assert.equal(models[0].id, 'llama-test');

  const health = await runner.health();
  assert.equal(health.ok, true);

  const response = await runner.infer({
    requestId: 'req-llama',
    modelId: 'llama-test',
    prompt: 'hi',
    maxTokens: 16,
  });
  assert.equal(response.output, 'echo:hi');

  server.close();
});
