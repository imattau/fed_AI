import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { AddressInfo } from 'node:net';

const startVllmServer = async () => {
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks).toString('utf8');

    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'vllm-test' }] }));
      return;
    }

    if (req.url === '/v1/completions') {
      const payload = JSON.parse(body) as { prompt: string };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ text: `echo:${payload.prompt}` }],
          usage: { prompt_tokens: 3, completion_tokens: 2 },
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

test('vLLM runner proxies to OpenAI completions endpoint', async () => {
  const { VllmRunner } = (await import(
    path.join(process.cwd(), 'src/runners/vllm/index.ts'),
  )) as typeof import('../../src/runners/vllm/index');
  const { server, baseUrl } = await startVllmServer();
  const runner = new VllmRunner({ baseUrl, defaultModelId: 'vllm-test' });

  const models = await runner.listModels();
  assert.equal(models[0].id, 'vllm-test');

  const response = await runner.infer({
    requestId: 'req-vllm',
    modelId: 'vllm-test',
    prompt: 'hi',
    maxTokens: 16,
  });
  assert.equal(response.output, 'echo:hi');

  server.close();
});
