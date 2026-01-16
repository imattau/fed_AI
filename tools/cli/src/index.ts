import { randomUUID, generateKeyPairSync } from 'node:crypto';
import {
  buildEnvelope,
  exportPrivateKeyHex,
  exportPublicKeyHex,
  parsePrivateKey,
  signEnvelope,
} from '@fed-ai/protocol';
import type { QuoteRequest, InferenceRequest } from '@fed-ai/protocol';

const usage = () => {
  return `fed-ai <command>

Commands:
  gen-keys
  quote --router <url> --key-id <pub> --private-key <hex|pem> --model <id> --input <n> --output <n> --max-tokens <n>
  infer --router <url> --key-id <pub> --private-key <hex|pem> --model <id> --prompt <text> --max-tokens <n>
`;
};

const parseArgs = (args: string[]): Record<string, string> => {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) {
      result[key] = 'true';
    } else {
      result[key] = value;
      i += 1;
    }
  }
  return result;
};

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
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const output = {
    publicKey: exportPublicKeyHex(publicKey),
    privateKey: exportPrivateKeyHex(privateKey),
  };
  console.log(JSON.stringify(output, null, 2));
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
