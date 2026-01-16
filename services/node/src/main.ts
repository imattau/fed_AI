import { randomUUID } from 'node:crypto';
import { buildEnvelope, parsePrivateKey, parsePublicKey, signEnvelope } from '@fed-ai/protocol';
import type { Capability, NodeDescriptor } from '@fed-ai/protocol';
import { discoverRelays } from '@fed-ai/nostr-relay-discovery';
import { createNodeService } from './server';
import { defaultNodeConfig, NodeConfig } from './config';
import { HttpRunner } from './runners/http';
import { MockRunner } from './runners/mock';
import { createNodeHttpServer } from './http';
import type { Runner } from './runners/types';

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

  return {
    ...defaultNodeConfig,
    nodeId: getEnv('NODE_ID') ?? defaultNodeConfig.nodeId,
    keyId: getEnv('NODE_KEY_ID') ?? defaultNodeConfig.keyId,
    endpoint: getEnv('NODE_ENDPOINT') ?? defaultNodeConfig.endpoint,
    routerEndpoint: getEnv('ROUTER_ENDPOINT') ?? defaultNodeConfig.routerEndpoint,
    heartbeatIntervalMs: Number(getEnv('NODE_HEARTBEAT_MS') ?? defaultNodeConfig.heartbeatIntervalMs),
    runnerName: getEnv('NODE_RUNNER') ?? defaultNodeConfig.runnerName,
    port: Number(getEnv('NODE_PORT') ?? 8081),
    capacityMaxConcurrent: Number(
      getEnv('NODE_CAPACITY_MAX') ?? defaultNodeConfig.capacityMaxConcurrent,
    ),
    capacityCurrentLoad: Number(
      getEnv('NODE_CAPACITY_LOAD') ?? defaultNodeConfig.capacityCurrentLoad,
    ),
    requirePayment: (getEnv('NODE_REQUIRE_PAYMENT') ?? 'false').toLowerCase() === 'true',
    privateKey: privateKey ? parsePrivateKey(privateKey) : undefined,
    routerPublicKey: routerPublicKey ? parsePublicKey(routerPublicKey) : undefined,
  };
};

const buildRunner = (config: NodeConfig): Runner => {
  if (config.runnerName === 'http') {
    const runnerUrl = getEnv('NODE_RUNNER_URL') ?? 'http://localhost:8085';
    return new HttpRunner({
      baseUrl: runnerUrl,
      defaultModelId: getEnv('NODE_MODEL_ID') ?? config.runnerName,
    });
  }
  return new MockRunner();
};

const start = (): void => {
  const config = buildConfig();
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
        currentLoad: config.capacityCurrentLoad,
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
