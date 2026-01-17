import { randomUUID } from 'node:crypto';
import { buildEnvelope, parsePrivateKey, parsePublicKey, signEnvelope } from '@fed-ai/protocol';
import type { Capability, NodeDescriptor } from '@fed-ai/protocol';
import { discoverRelays } from '@fed-ai/nostr-relay-discovery';
import { createNodeService } from './server';
import { defaultNodeConfig, NodeConfig } from './config';
import { HttpRunner } from './runners/http';
import { LlamaCppRunner } from './runners/llama_cpp';
import { MockRunner } from './runners/mock';
import { VllmRunner } from './runners/vllm';
import { createNodeHttpServer } from './http';
import type { Runner } from './runners/types';
import { enforceSandboxPolicy } from './sandbox/policy';

const getEnv = (key: string): string | undefined => {
  return process.env[key];
};

/** Parse comma-separated inputs so operators can override discovery sources. */
const parseList = (value?: string): string[] | undefined => {
  return value
    ?.split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

/** Convert optional trust-score overrides into the expected map shape. */
const parseTrustScores = (value?: string): Record<string, number> | undefined => {
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

/** Helper to parse integers or floats for discovery arguments. */
const parseNumber = (value?: string, float = false): number | undefined => {
  if (!value) {
    return undefined;
  }
  const parsed = float ? Number.parseFloat(value) : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** Build discovery configuration for the node using `NODE_*` env overrides. */
const buildDiscoveryOptions = () => ({
  bootstrapRelays: parseList(getEnv('NODE_RELAY_BOOTSTRAP')),
  aggregatorUrls: parseList(getEnv('NODE_RELAY_AGGREGATORS')),
  trustScores: parseTrustScores(getEnv('NODE_RELAY_TRUST')),
  minScore: parseNumber(getEnv('NODE_RELAY_MIN_SCORE'), true),
  maxResults: parseNumber(getEnv('NODE_RELAY_MAX_RESULTS')),
});

/** Log the discovery summary so operators can verify the runtime choices. */
const logRelayCandidates = async (
  role: string,
  options: Parameters<typeof discoverRelays>[0],
): Promise<void> => {
  try {
    const relays = await discoverRelays(options);
    const snippet = relays.slice(0, 3).map((entry) => entry.url).join(', ') || 'none';
    console.log(`[${role}] discovered ${relays.length} relays (top: ${snippet})`);
  } catch (error) {
    console.warn(
      `[${role}] relay discovery failed`,
      error instanceof Error ? error.message : String(error),
    );
  }
};

const buildConfig = (): NodeConfig => {
  const privateKey = getEnv('NODE_PRIVATE_KEY_PEM');
  const routerPublicKey = getEnv('ROUTER_PUBLIC_KEY_PEM');
  const routerKeyId = getEnv('ROUTER_KEY_ID');
  const sandboxAllowedRunners = parseList(getEnv('NODE_SANDBOX_ALLOWED_RUNNERS'));
  const sandboxAllowedEndpoints = parseList(getEnv('NODE_SANDBOX_ALLOWED_ENDPOINTS'));

  return {
    ...defaultNodeConfig,
    nodeId: getEnv('NODE_ID') ?? defaultNodeConfig.nodeId,
    keyId: getEnv('NODE_KEY_ID') ?? defaultNodeConfig.keyId,
    endpoint: getEnv('NODE_ENDPOINT') ?? defaultNodeConfig.endpoint,
    routerEndpoint: getEnv('ROUTER_ENDPOINT') ?? defaultNodeConfig.routerEndpoint,
    routerKeyId: routerKeyId ?? undefined,
    heartbeatIntervalMs: Number(getEnv('NODE_HEARTBEAT_MS') ?? defaultNodeConfig.heartbeatIntervalMs),
    runnerName: getEnv('NODE_RUNNER') ?? defaultNodeConfig.runnerName,
    port: Number(getEnv('NODE_PORT') ?? 8081),
    capacityMaxConcurrent: Number(
      getEnv('NODE_CAPACITY_MAX') ?? defaultNodeConfig.capacityMaxConcurrent,
    ),
    capacityCurrentLoad: Number(
      getEnv('NODE_CAPACITY_LOAD') ?? defaultNodeConfig.capacityCurrentLoad,
    ),
    maxPromptBytes: parseNumber(getEnv('NODE_MAX_PROMPT_BYTES')),
    maxTokens: parseNumber(getEnv('NODE_MAX_TOKENS')),
    runnerTimeoutMs: parseNumber(getEnv('NODE_RUNNER_TIMEOUT_MS')),
    sandboxMode: (getEnv('NODE_SANDBOX_MODE') as NodeConfig['sandboxMode']) ?? 'disabled',
    sandboxAllowedRunners: sandboxAllowedRunners ?? undefined,
    sandboxAllowedEndpoints: sandboxAllowedEndpoints ?? undefined,
    maxRequestBytes: parseNumber(getEnv('NODE_MAX_REQUEST_BYTES')),
    maxInferenceMs: parseNumber(getEnv('NODE_MAX_RUNTIME_MS')),
    requirePayment: (getEnv('NODE_REQUIRE_PAYMENT') ?? 'false').toLowerCase() === 'true',
    privateKey: privateKey ? parsePrivateKey(privateKey) : undefined,
    routerPublicKey: routerPublicKey ? parsePublicKey(routerPublicKey) : undefined,
  };
};

const buildRunner = (config: NodeConfig): Runner => {
  const ensureEndpointAllowed = (baseUrl: string): void => {
    if (config.sandboxMode !== 'restricted') {
      return;
    }
    if (!config.sandboxAllowedEndpoints || config.sandboxAllowedEndpoints.length === 0) {
      return;
    }
    const allowed = config.sandboxAllowedEndpoints.some((entry) => baseUrl.startsWith(entry));
    if (!allowed) {
      throw new Error('sandbox-endpoint-not-allowed');
    }
  };

  if (config.runnerName === 'http') {
    const runnerUrl = getEnv('NODE_RUNNER_URL') ?? 'http://localhost:8085';
    ensureEndpointAllowed(runnerUrl);
    return new HttpRunner({
      baseUrl: runnerUrl,
      defaultModelId: getEnv('NODE_MODEL_ID') ?? config.runnerName,
      timeoutMs: config.runnerTimeoutMs,
    });
  }
  if (config.runnerName === 'llama_cpp') {
    const runnerUrl = getEnv('NODE_LLAMA_CPP_URL') ?? getEnv('NODE_RUNNER_URL') ?? 'http://localhost:8085';
    ensureEndpointAllowed(runnerUrl);
    return new LlamaCppRunner({
      baseUrl: runnerUrl,
      defaultModelId: getEnv('NODE_MODEL_ID') ?? 'llama-model',
      timeoutMs: config.runnerTimeoutMs,
    });
  }
  if (config.runnerName === 'vllm') {
    const runnerUrl = getEnv('NODE_VLLM_URL') ?? getEnv('NODE_RUNNER_URL') ?? 'http://localhost:8085';
    ensureEndpointAllowed(runnerUrl);
    return new VllmRunner({
      baseUrl: runnerUrl,
      defaultModelId: getEnv('NODE_MODEL_ID') ?? 'vllm-model',
      timeoutMs: config.runnerTimeoutMs,
    });
  }
  return new MockRunner();
};

const start = (): void => {
  const config = buildConfig();
  const sandboxCheck = enforceSandboxPolicy(config);
  if (!sandboxCheck.ok) {
    throw new Error(`sandbox-policy-violation:${sandboxCheck.error}`);
  }
  const runner = buildRunner(config);
  const service = createNodeService(config, runner);
  const server = createNodeHttpServer(service, config);

  server.listen(config.port);
  void logRelayCandidates('node', buildDiscoveryOptions());

  if (config.privateKey) {
    void startHeartbeat(service, config).catch((error) => {
      console.warn('heartbeat-start-failed', error instanceof Error ? error.message : String(error));
    });
  } else {
    console.warn('heartbeat-disabled: node private key missing');
  }
};

start();

const buildCapabilities = async (runner: Runner): Promise<Capability[]> => {
  // Pricing is a placeholder until node pricing configuration is wired in.
  const models = await runner.listModels();
  return models.map((model) => ({
    modelId: model.id,
    contextWindow: model.contextWindow,
    maxTokens: model.contextWindow,
    pricing: {
      unit: 'token',
      inputRate: 0,
      outputRate: 0,
      currency: 'USD',
    },
  }));
};

const startHeartbeat = async (service: ReturnType<typeof createNodeService>, config: NodeConfig) => {
  const capabilities = await buildCapabilities(service.runner);

  const sendHeartbeat = async (): Promise<void> => {
    const descriptor: NodeDescriptor = {
      nodeId: config.nodeId,
      keyId: config.keyId,
      endpoint: config.endpoint,
      capacity: {
        maxConcurrent: config.capacityMaxConcurrent,
        currentLoad: config.capacityCurrentLoad + service.inFlight,
      },
      capabilities,
    };

    if (!config.privateKey) {
      return;
    }

    const envelope = signEnvelope(
      buildEnvelope(descriptor, randomUUID(), Date.now(), config.keyId),
      config.privateKey,
    );

    try {
      await fetch(`${config.routerEndpoint}/register-node`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(envelope),
      });
    } catch (error) {
      console.warn('heartbeat-send-failed', error instanceof Error ? error.message : String(error));
    }
  };

  await sendHeartbeat();
  setInterval(sendHeartbeat, config.heartbeatIntervalMs);
};
