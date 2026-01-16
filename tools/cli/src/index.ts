import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import {
  buildEnvelope,
  parsePrivateKey,
  signEnvelope,
} from '@fed-ai/protocol';
import { profileSystem } from '@fed-ai/profiler';
import { runBench } from '@fed-ai/bench';
import { recommend } from '@fed-ai/recommender';
import { signManifest } from '@fed-ai/manifest';
import { discoverRelays } from '@fed-ai/nostr-relay-discovery';
import type {
  Envelope,
  InferenceRequest,
  PaymentReceipt,
  PaymentRequest,
  QuoteRequest,
} from '@fed-ai/protocol';
import type { BenchOptions, BenchResult } from '@fed-ai/bench';
import type { ProfileReport } from '@fed-ai/profiler';
import type { NodeManifest, RouterManifest } from '@fed-ai/manifest';
import { generateKeyPairHex, parseArgs, usage } from './lib';

const postJson = async (url: string, body: unknown): Promise<Response> => {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
};

const loadJson = async <T>(path: string): Promise<T> => {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as T;
};

/** Split comma-separated values into normalized arrays for discovery overrides. */
const parseListArg = (value?: string): string[] | undefined => {
  return value
    ?.split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

/** Convert trust-score overrides (`url=score`) into a map. */
const parseTrustScoresArg = (value?: string): Record<string, number> | undefined => {
  if (!value) {
    return undefined;
  }
  const result: Record<string, number> = {};
  for (const piece of value.split(',')) {
    const [rawUrl, rawScore] = piece.split('=').map((item) => item.trim());
    if (!rawUrl || !rawScore) {
      continue;
    }
    const score = Number.parseFloat(rawScore);
    if (Number.isFinite(score)) {
      result[rawUrl] = score;
    }
  }
  return Object.keys(result).length ? result : undefined;
};

/** Parse integer or floating-point arguments. */
const parseNumberArg = (value?: string, float = false): number | undefined => {
  if (!value) {
    return undefined;
  }
  const parsed = float ? Number.parseFloat(value) : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** Build discovery options from CLI arguments. */
const buildDiscoveryOptionsFromArgs = (args: Record<string, string>) => ({
  bootstrapRelays: parseListArg(args.bootstrap),
  aggregatorUrls: parseListArg(args.aggregators),
  trustScores: parseTrustScoresArg(args['trust-scores']),
  minScore: parseNumberArg(args['min-score'], true),
  maxResults: parseNumberArg(args['max-results']),
});

const run = async (): Promise<void> => {
  const command = process.argv[2];
  if (!command) {
    console.error(usage());
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(3));

  if (command === 'gen-keys') {
    console.log(JSON.stringify(generateKeyPairHex(), null, 2));
    return;
  }

  if (command === 'profile') {
    const targets = args['latency-targets']?.split(',').filter(Boolean) ?? [];
    const profile = await profileSystem({ latencyTargets: targets });
    console.log(JSON.stringify(profile, null, 2));
    return;
  }

  if (command === 'bench') {
    const mode = (args.mode ?? 'node') as BenchOptions['mode'];
    const targets = args['latency-targets']?.split(',').filter(Boolean) ?? [];
    const bench = await runBench({ mode, latencyTargets: targets });
    console.log(JSON.stringify(bench, null, 2));
    return;
  }

  if (command === 'recommend') {
    const profilePath = args.profile;
    const benchPath = args.bench;
    if (!profilePath) {
      console.error('Missing --profile');
      process.exit(1);
    }

    const [profile, bench] = await Promise.all([
      loadJson<ProfileReport>(profilePath),
      benchPath ? loadJson<BenchResult>(benchPath) : Promise.resolve(null),
    ]);

    const result = recommend({
      hardware: profile.hardware,
      network: profile.network,
      bands: profile.capabilityBands,
      benchmarks: bench,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'manifest') {
    const role = args.role as 'node' | 'router';
    const id = args.id;
    const keyId = args['key-id'];
    const privateKeyInput = args['private-key'];
    const profilePath = args.profile;
    const benchPath = args.bench;
    const outPath = args.write;

    if (!role || !id || !keyId || !privateKeyInput || !profilePath || !outPath) {
      console.error('Missing required manifest args');
      process.exit(1);
    }

    const privateKey = parsePrivateKey(privateKeyInput);
    const [profile, bench] = await Promise.all([
      loadJson<ProfileReport>(profilePath),
      benchPath ? loadJson<BenchResult>(benchPath) : Promise.resolve(null),
    ]);

    if (role === 'node') {
      const manifest: NodeManifest = {
        id,
        role_types: (args.roles ?? 'prepost_node').split(',').filter(Boolean),
        capability_bands: profile.capabilityBands,
        limits: {
          max_concurrency: Number(args.maxConcurrency ?? 2),
          max_payload_bytes: Number(args.maxPayloadBytes ?? 262144),
          max_tokens: Number(args.maxTokens ?? 256),
        },
        supported_formats: (args.formats ?? 'text').split(',').filter(Boolean),
        pricing_defaults: {
          unit: 'token',
          input_rate: Number(args.inputRate ?? 0),
          output_rate: Number(args.outputRate ?? 0),
          currency: args.currency ?? 'USD',
        },
        benchmarks: bench,
        software_version: args.version ?? '0.0.1',
      };

      const signed = signManifest(manifest, keyId, privateKey) as NodeManifest;
      await writeFile(outPath, JSON.stringify(signed, null, 2));
      console.log(`Wrote ${outPath}`);
      return;
    }

    const manifest: RouterManifest = {
      id,
      router_mode: 'probation',
      capability_bands: profile.capabilityBands,
      limits: {
        max_qps: Number(args.maxQps ?? 100),
        max_concurrent_jobs: Number(args.maxConcurrentJobs ?? 50),
        max_payload_bytes: Number(args.maxPayloadBytes ?? 262144),
      },
      policies_enabled: (args.policies ?? 'rate_limit').split(',').filter(Boolean),
      audit_mode: (args.auditMode as RouterManifest['audit_mode']) ?? 'basic',
      benchmarks: bench,
      software_version: args.version ?? '0.0.1',
    };

    const signed = signManifest(manifest, keyId, privateKey) as RouterManifest;
    await writeFile(outPath, JSON.stringify(signed, null, 2));
    console.log(`Wrote ${outPath}`);
    return;
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
    const response = await postJson(`${router}/quote`, envelope);
    const body = await response.text();
    if (!response.ok) {
      console.error(body || response.statusText);
      process.exit(1);
    }
    console.log(body);
    return;
  }

  if (command === 'infer') {
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

    const receipts: Envelope<PaymentReceipt>[] = [];
    const receiptPaths = (args.receipts ?? '').split(',').map((item) => item.trim()).filter(Boolean);
    if (receiptPaths.length > 0) {
      await Promise.all(
        receiptPaths.map(async (path) => {
          const envelope = await loadJson<Envelope<PaymentReceipt>>(path);
          receipts.push(envelope);
        }),
      );
    }

    const payload: InferenceRequest = {
      ...request,
      paymentReceipts: receipts.length ? receipts : undefined,
    };

    const envelope = signEnvelope(buildEnvelope(payload, randomUUID(), Date.now(), keyId), privateKey);
    const response = await postJson(`${router}/infer`, envelope);
    const body = await response.text();
    if (!response.ok) {
      if (response.status === 402) {
        try {
          const parsed = JSON.parse(body) as { payment: unknown };
          const paymentEnvelope = parsed.payment as Envelope<PaymentRequest>;
          console.log('Payment required:', JSON.stringify(paymentEnvelope.payload, null, 2));
          if (args['payment-request-out']) {
            await writeFile(args['payment-request-out'], JSON.stringify(paymentEnvelope, null, 2));
            console.log(`Saved payment request to ${args['payment-request-out']}`);
          }
        } catch {
          // ignore parse errors
        }
      }
      console.error(body || response.statusText);
      process.exit(1);
    }
    console.log(body);
    return;
  }

  if (command === 'receipt') {
    const requestPath = args['payment-request'];
    const keyId = args['key-id'];
    const privateKeyInput = args['private-key'];
    if (!requestPath || !keyId || !privateKeyInput) {
      console.error('Missing required receipt args');
      process.exit(1);
    }

    const privateKey = parsePrivateKey(privateKeyInput);
    const paymentEnvelope = await loadJson<Envelope<PaymentRequest>>(requestPath);
    const receiptPayload: PaymentReceipt = {
      requestId: paymentEnvelope.payload.requestId,
      payeeType: paymentEnvelope.payload.payeeType,
      payeeId: paymentEnvelope.payload.payeeId,
      amountSats: Number(args.amount ?? paymentEnvelope.payload.amountSats),
      paidAtMs: Number(args['paid-at-ms'] ?? Date.now()),
      invoice: args.invoice ?? paymentEnvelope.payload.invoice,
      paymentHash: args['payment-hash'],
      preimage: args.preimage,
    };

    const receiptEnvelope = signEnvelope(
      buildEnvelope(receiptPayload, randomUUID(), Date.now(), keyId),
      privateKey,
    );

    if (args.write) {
      await writeFile(args.write, JSON.stringify(receiptEnvelope, null, 2));
      console.log(`Wrote receipt to ${args.write}`);
    } else {
      console.log(JSON.stringify(receiptEnvelope, null, 2));
    }

    if (args.router) {
      const response = await postJson(`${args.router}/payment-receipt`, receiptEnvelope);
      const text = await response.text();
      if (!response.ok) {
        console.error(text || response.statusText);
        process.exit(1);
      }
      console.log('Router accepted payment receipt');
    }

    return;
  }

  if (command === 'relays') {
    const relays = await discoverRelays(buildDiscoveryOptionsFromArgs(args));
    console.log(JSON.stringify(relays, null, 2));
    return;
  }

  console.error(usage());
  process.exit(1);
};

run().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
