import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import type { InferenceRequest } from '@fed-ai/protocol';

const startStubRunner = async () => {
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks).toString('utf8');

    if (req.url === '/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ models: [{ id: 'llama-test', contextWindow: 1024, maxTokens: 512 }] }));
      return;
    }

    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.url === '/estimate') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ costEstimate: 0.1, latencyEstimateMs: 42 }));
      return;
    }

    if (req.url === '/infer') {
      const payload: InferenceRequest = JSON.parse(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          requestId: payload.requestId,
          modelId: payload.modelId,
          output: `echo:${payload.prompt}`,
          usage: { inputTokens: payload.prompt.length, outputTokens: 2 },
          latencyMs: 37,
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

test('http runner proxies to model server', async () => {
  const { HttpRunner } = (await import(
    path.join(process.cwd(), 'src/runners/http/index.ts'),
  )) as typeof import('../../src/runners/http/index');
  const { server, baseUrl } = await startStubRunner();
  const runner = new HttpRunner({ baseUrl, defaultModelId: 'llama-test' });

  const models = await runner.listModels();
  assert.equal(models.length, 1);
  assert.equal(models[0].id, 'llama-test');

  const health = await runner.health();
  assert.equal(health.ok, true);

  const estimate = await runner.estimate({
    requestId: 'req',
    modelId: 'llama-test',
    prompt: 'hi',
    maxTokens: 16,
  });
  assert.equal(estimate.latencyEstimateMs, 42);

  const response = await runner.infer({
    requestId: 'req-infer',
    modelId: 'llama-test',
    prompt: 'hello world',
    maxTokens: 32,
  });
  assert.equal(response.output, 'echo:hello world');
  assert.equal(response.usage.inputTokens, 11);

  server.close();
});
