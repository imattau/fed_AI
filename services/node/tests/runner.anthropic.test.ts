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

const startAnthropicServer = async () => {
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks).toString('utf8');

    if (req.url === '/v1/models') {
      if (req.headers['x-api-key'] !== 'test-key') {
        res.writeHead(401);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'claude-test' }] }));
      return;
    }

    if (req.url === '/v1/messages') {
      if (req.headers['x-api-key'] !== 'test-key') {
        res.writeHead(401);
        res.end();
        return;
      }
      const payload = JSON.parse(body) as { messages: Array<{ content: string }> };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          content: [{ text: `echo:${payload.messages[0].content}` }],
          usage: { input_tokens: 3, output_tokens: 2 },
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

test('anthropic runner proxies to messages endpoint', async () => {
  const { AnthropicRunner } = (await import(
    path.join(process.cwd(), 'src/runners/anthropic/index.ts'),
  )) as typeof import('../../src/runners/anthropic/index');
  const { server, baseUrl } = await startAnthropicServer();
  const runner = new AnthropicRunner({
    baseUrl,
    defaultModelId: 'claude-test',
    apiKey: 'test-key',
  });

  const response = await runner.infer({
    requestId: 'req-claude',
    modelId: 'claude-test',
    prompt: 'hi',
    maxTokens: 16,
  });
  assert.equal(response.output, 'echo:hi');

  await closeServer(server);
});
