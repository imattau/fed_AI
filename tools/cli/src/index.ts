import { randomUUID } from 'node:crypto';
import { buildEnvelope, parsePrivateKey, signEnvelope } from '@fed-ai/protocol';
import type { QuoteRequest, InferenceRequest } from '@fed-ai/protocol';
import { generateKeyPairHex, parseArgs, usage } from './lib';

const postJson = async (url: string, body: unknown): Promise<Response> => {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
};

const command = process.argv[2];
if (!command) {
  console.error(usage());
  process.exit(1);
}

const args = parseArgs(process.argv.slice(3));

if (command === 'gen-keys') {
  console.log(JSON.stringify(generateKeyPairHex(), null, 2));
  process.exit(0);
}

if (command === 'quote') {
  const router = args.router;
  const keyId = args['key-id'];
  const privateKeyInput = args['private-key'];
  const modelId = args.model;
  const input = Number(args.input);
  const output = Number(args.output);
  const maxTokens = Number(args['max-tokens']);

  if (!router || !keyId || !privateKeyInput || !modelId || !Number.isFinite(input) || !Number.isFinite(output)) {
    console.error(usage());
    process.exit(1);
  }

  const privateKey = parsePrivateKey(privateKeyInput);
  const request: QuoteRequest = {
    requestId: randomUUID(),
    modelId,
    maxTokens: Number.isFinite(maxTokens) ? maxTokens : 0,
    inputTokensEstimate: input,
    outputTokensEstimate: output,
  };

  const envelope = signEnvelope(buildEnvelope(request, randomUUID(), Date.now(), keyId), privateKey);
  postJson(`${router}/quote`, envelope)
    .then(async (response) => {
      const body = await response.text();
      if (!response.ok) {
        console.error(body || response.statusText);
        process.exit(1);
      }
      console.log(body);
    })
    .catch((error) => {
      console.error(String(error));
      process.exit(1);
    });
} else if (command === 'infer') {
  const router = args.router;
  const keyId = args['key-id'];
  const privateKeyInput = args['private-key'];
  const modelId = args.model;
  const prompt = args.prompt;
  const maxTokens = Number(args['max-tokens']);

  if (!router || !keyId || !privateKeyInput || !modelId || !prompt || !Number.isFinite(maxTokens)) {
    console.error(usage());
    process.exit(1);
  }

  const privateKey = parsePrivateKey(privateKeyInput);
  const request: InferenceRequest = {
    requestId: randomUUID(),
    modelId,
    prompt,
    maxTokens,
  };

  const envelope = signEnvelope(buildEnvelope(request, randomUUID(), Date.now(), keyId), privateKey);
  postJson(`${router}/infer`, envelope)
    .then(async (response) => {
      const body = await response.text();
      if (!response.ok) {
        console.error(body || response.statusText);
        process.exit(1);
      }
      console.log(body);
    })
    .catch((error) => {
      console.error(String(error));
      process.exit(1);
    });
} else {
  console.error(usage());
  process.exit(1);
}
