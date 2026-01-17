import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { AddressInfo } from 'node:net';

const closeServer = (server: http.Server) => {
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  return new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
};

const startOpenAiServer = async () => {
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks).toString('utf8');

    if (req.url === '/v1/models') {
      if (req.headers.authorization !== 'Bearer test-key') {
        res.writeHead(401);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'openai-test' }] }));
      return;
    }

    if (req.url === '/v1/chat/completions') {
      if (req.headers.authorization !== 'Bearer test-key') {
        res.writeHead(401);
        res.end();
        return;
      }
      const payload = JSON.parse(body) as { messages: Array<{ content: string }> };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: `echo:${payload.messages[0].content}` } }],
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

test('openai runner proxies to chat completions endpoint', async () => {
  const { OpenAiRunner } = (await import(
    path.join(process.cwd(), 'src/runners/openai/index.ts'),
  )) as typeof import('../../src/runners/openai/index');
  const { server, baseUrl } = await startOpenAiServer();
  const runner = new OpenAiRunner({
    baseUrl,
    defaultModelId: 'openai-test',
    apiKey: 'test-key',
    mode: 'chat',
  });

  const models = await runner.listModels();
  assert.equal(models[0].id, 'openai-test');

  const response = await runner.infer({
    requestId: 'req-openai',
    modelId: 'openai-test',
    prompt: 'hi',
    maxTokens: 16,
  });
  assert.equal(response.output, 'echo:hi');

  await closeServer(server);
});
