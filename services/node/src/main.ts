import { randomUUID } from 'node:crypto';
import {
  buildEnvelope,
  decodeNpubToHex,
  derivePublicKeyHex,
  exportPublicKeyHex,
  isNostrNpub,
  parsePrivateKey,
  parsePublicKey,
  signEnvelope,
  exportPublicKeyNpub,
} from '@fed-ai/protocol';
import type { Capability, ModelInfo, NodeDescriptor } from '@fed-ai/protocol';
import { discoverRelays } from '@fed-ai/nostr-relay-discovery';
import { createNodeService } from './server';
import { defaultNodeConfig, NodeConfig } from './config';
import { HttpRunner } from './runners/http';
import { LlamaCppRunner } from './runners/llama_cpp';
import { OpenAiRunner } from './runners/openai';
import { AnthropicRunner } from './runners/anthropic';
import { VllmRunner } from './runners/vllm';
import { CpuStatsRunner } from './runners/cpu';
import { createNodeHttpServer } from './http';
import type { Runner } from './runners/types';
import { enforceSandboxPolicy } from './sandbox/policy';
import { logInfo, logWarn } from './logging';
import { createPostgresNonceStore } from './storage/postgres-nonce';
import { FileNonceStore, InMemoryNonceStore, NonceStore } from '@fed-ai/protocol';

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

/** Parse comma-separated Nostr npub lists, discarding invalid entries. */
const parseNpubList = (value?: string): string[] | undefined => {
  const entries = parseList(value);
  if (!entries) {
    return undefined;
  }
  const filtered = entries.filter((entry) => isNostrNpub(entry));
  return filtered.length > 0 ? filtered : undefined;
};

const JOB_TYPES = new Set([
  'EMBEDDING',
  'RERANK',
  'CLASSIFY',
  'MODERATE',
  'TOOL_CALL',
  'SUMMARISE',
  'GEN_CHUNK',
]);

const parseJobTypes = (value?: string): NodeConfig['capabilityJobTypes'] => {
  const entries = parseList(value);
  if (!entries || entries.length === 0) {
    return undefined;
  }
  const filtered = entries.filter((entry) => JOB_TYPES.has(entry));
  return filtered.length > 0 ? (filtered as NodeConfig['capabilityJobTypes']) : undefined;
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
    logInfo(`[${role}] discovered ${relays.length} relays (top: ${snippet})`);
  } catch (error) {
    logWarn(`[${role}] relay discovery failed`, error);
  }
};

const buildConfig = (): NodeConfig => {
  const privateKey = getEnv('NODE_PRIVATE_KEY_PEM');
  const routerPublicKey = getEnv('ROUTER_PUBLIC_KEY_PEM');
  const routerKeyId = getEnv('ROUTER_KEY_ID');
  const tlsCertPath = getEnv('NODE_TLS_CERT_PATH');
  const tlsKeyPath = getEnv('NODE_TLS_KEY_PATH');
  const tlsCaPath = getEnv('NODE_TLS_CA_PATH');
  const tlsRequireClientCert =
    (getEnv('NODE_TLS_REQUIRE_CLIENT_CERT') ?? 'false').toLowerCase() === 'true';
  const paymentVerifyUrl = getEnv('NODE_LN_VERIFY_URL');
  const paymentVerifyTimeoutMs = parseNumber(getEnv('NODE_LN_VERIFY_TIMEOUT_MS'));
  const paymentRequirePreimage =
    (getEnv('NODE_LN_REQUIRE_PREIMAGE') ?? 'false').toLowerCase() === 'true';
  const nonceStoreUrl = getEnv('NODE_NONCE_STORE_URL');
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
    routerPublicKey: routerPublicKey
      ? parsePublicKey(routerPublicKey)
      : routerKeyId
        ? parsePublicKey(routerKeyId)
        : undefined,
    routerAllowList: parseNpubList(getEnv('NODE_ROUTER_ALLOWLIST')),
    routerFollowList: parseNpubList(getEnv('NODE_ROUTER_FOLLOW')),
    routerMuteList: parseNpubList(getEnv('NODE_ROUTER_MUTE')),
    routerBlockList: parseNpubList(getEnv('NODE_ROUTER_BLOCK')),
    rateLimitMax: parseNumber(getEnv('NODE_RATE_LIMIT_MAX')),
    rateLimitWindowMs: parseNumber(getEnv('NODE_RATE_LIMIT_WINDOW_MS')),
    offloadPeers: parseList(getEnv('NODE_OFFLOAD_PEERS')),
    offloadRouter: (getEnv('NODE_OFFLOAD_ROUTER') ?? 'false').toLowerCase() === 'true',
    offloadAuctionEnabled: (getEnv('NODE_OFFLOAD_AUCTION') ?? 'false').toLowerCase() === 'true',
    offloadAuctionMs: parseNumber(getEnv('NODE_OFFLOAD_AUCTION_MS'), true) ?? defaultNodeConfig.offloadAuctionMs,
    offloadAuctionAllowList: parseNpubList(getEnv('NODE_OFFLOAD_AUCTION_ALLOWLIST')),
    offloadAuctionRateLimit:
      parseNumber(getEnv('NODE_OFFLOAD_AUCTION_RATE_LIMIT'), true) ??
      defaultNodeConfig.offloadAuctionRateLimit,
    nonceStorePath: getEnv('NODE_NONCE_STORE_PATH'),
    nonceStoreUrl,
    capabilityJobTypes: parseJobTypes(getEnv('NODE_JOB_TYPES')),
    capabilityLatencyMs: parseNumber(getEnv('NODE_LATENCY_ESTIMATE_MS'), true),
    tls:
      tlsCertPath && tlsKeyPath
        ? {
            certPath: tlsCertPath,
            keyPath: tlsKeyPath,
            caPath: tlsCaPath ?? undefined,
            requireClientCert: tlsRequireClientCert,
          }
        : undefined,
    paymentVerification: paymentVerifyUrl
      ? {
          url: paymentVerifyUrl,
          timeoutMs: paymentVerifyTimeoutMs,
          requirePreimage: paymentRequirePreimage,
        }
      : undefined,
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
      apiKey: getEnv('NODE_RUNNER_API_KEY'),
      timeoutMs: config.runnerTimeoutMs,
    });
  }
  if (config.runnerName === 'llama_cpp') {
    const runnerUrl = getEnv('NODE_LLAMA_CPP_URL') ?? getEnv('NODE_RUNNER_URL') ?? 'http://localhost:8085';
    ensureEndpointAllowed(runnerUrl);
    return new LlamaCppRunner({
      baseUrl: runnerUrl,
      defaultModelId: getEnv('NODE_MODEL_ID') ?? 'llama-model',
      apiKey: getEnv('NODE_LLAMA_CPP_API_KEY') ?? getEnv('NODE_RUNNER_API_KEY'),
      timeoutMs: config.runnerTimeoutMs,
    });
  }
  if (config.runnerName === 'vllm') {
    const runnerUrl = getEnv('NODE_VLLM_URL') ?? getEnv('NODE_RUNNER_URL') ?? 'http://localhost:8085';
    ensureEndpointAllowed(runnerUrl);
    return new VllmRunner({
      baseUrl: runnerUrl,
      defaultModelId: getEnv('NODE_MODEL_ID') ?? 'vllm-model',
      apiKey: getEnv('NODE_VLLM_API_KEY') ?? getEnv('NODE_RUNNER_API_KEY'),
      timeoutMs: config.runnerTimeoutMs,
    });
  }
  if (config.runnerName === 'openai') {
    const runnerUrl = getEnv('NODE_OPENAI_URL') ?? getEnv('NODE_RUNNER_URL') ?? 'https://api.openai.com';
    const mode = (getEnv('NODE_OPENAI_MODE') as 'chat' | 'completion' | undefined) ?? 'chat';
    ensureEndpointAllowed(runnerUrl);
    return new OpenAiRunner({
      baseUrl: runnerUrl,
      defaultModelId: getEnv('NODE_OPENAI_MODEL') ?? getEnv('NODE_MODEL_ID') ?? 'gpt-4o-mini',
      apiKey: getEnv('NODE_OPENAI_API_KEY') ?? getEnv('NODE_RUNNER_API_KEY'),
      timeoutMs: config.runnerTimeoutMs,
      mode,
    });
  }
  if (config.runnerName === 'anthropic') {
    const runnerUrl = getEnv('NODE_ANTHROPIC_URL') ?? getEnv('NODE_RUNNER_URL') ?? 'https://api.anthropic.com';
    ensureEndpointAllowed(runnerUrl);
    return new AnthropicRunner({
      baseUrl: runnerUrl,
      defaultModelId: getEnv('NODE_ANTHROPIC_MODEL') ?? getEnv('NODE_MODEL_ID') ?? 'claude-3-haiku-20240307',
      apiKey: getEnv('NODE_ANTHROPIC_API_KEY') ?? getEnv('NODE_RUNNER_API_KEY'),
      timeoutMs: config.runnerTimeoutMs,
    });
  }
  if (config.runnerName === 'cpu') {
    return new CpuStatsRunner(getEnv('NODE_MODEL_ID') ?? 'cpu-stats');
  }
  throw new Error(`unsupported-runner:${config.runnerName}`);
};

const validateNostrIdentity = (keyId: string, privateKey?: Uint8Array): void => {
  if (!isNostrNpub(keyId)) {
    throw new Error('node keyId must be a Nostr npub');
  }
  if (privateKey) {
    const expected = decodeNpubToHex(keyId);
    const derived = derivePublicKeyHex(privateKey);
    if (expected !== derived) {
      throw new Error('node private key does not match keyId');
    }
  }
};

const validateRouterIdentity = (
  routerKeyId?: string,
  routerPublicKey?: Uint8Array,
): void => {
  if (!routerKeyId) {
    return;
  }
  if (!isNostrNpub(routerKeyId)) {
    throw new Error('router keyId must be a Nostr npub');
  }
  if (routerPublicKey) {
    const expected = decodeNpubToHex(routerKeyId);
    const actual = exportPublicKeyHex(routerPublicKey);
    if (expected !== actual) {
      throw new Error('router public key does not match router keyId');
    }
  }
};

const validateConfig = (config: NodeConfig): string[] => {
  const issues: string[] = [];
  if (!config.keyId) {
    issues.push('NODE_KEY_ID is required (npub).');
  } else if (!isNostrNpub(config.keyId)) {
    issues.push('NODE_KEY_ID must be a Nostr npub.');
  }
  if (!config.privateKey) {
    issues.push('NODE_PRIVATE_KEY_PEM (nsec/hex) is required to sign heartbeats.');
  }
  if (!config.routerEndpoint) {
    issues.push('ROUTER_ENDPOINT is required.');
  }
  if (config.routerKeyId && !isNostrNpub(config.routerKeyId)) {
    issues.push('ROUTER_KEY_ID must be a Nostr npub when set.');
  }
  return issues;
};

const start = async (): Promise<void> => {
  const config = buildConfig();
  if (!config.routerKeyId && config.routerPublicKey) {
    config.routerKeyId = exportPublicKeyNpub(config.routerPublicKey);
  }
  const issues = validateConfig(config);
  if (issues.length > 0) {
    logWarn('[node] invalid configuration', { issues });
    process.exit(1);
  }
  validateNostrIdentity(config.keyId, config.privateKey);
  validateRouterIdentity(config.routerKeyId, config.routerPublicKey);
  const sandboxCheck = enforceSandboxPolicy(config);
  if (!sandboxCheck.ok) {
    throw new Error(`sandbox-policy-violation:${sandboxCheck.error}`);
  }
  const runner = buildRunner(config);
  const service = createNodeService(config, runner);
  let nonceStore: NonceStore = config.nonceStorePath
    ? new FileNonceStore(config.nonceStorePath)
    : new InMemoryNonceStore();
  if (config.nonceStoreUrl) {
    try {
      nonceStore = await createPostgresNonceStore(config.nonceStoreUrl);
    } catch (error) {
      logWarn('[node] failed to initialize nonce store', error);
    }
  }
  const server = createNodeHttpServer(service, config, nonceStore);

  server.listen(config.port);
  void logRelayCandidates('node', buildDiscoveryOptions());

  if (config.privateKey) {
    void startHeartbeat(service, config).catch((error) => {
      logWarn('heartbeat-start-failed', error);
    });
  } else {
    logWarn('heartbeat-disabled: node private key missing');
  }
};

void start();

async function buildCapabilities(runner: Runner, config: NodeConfig): Promise<Capability[]> {
  // Pricing is a placeholder until node pricing configuration is wired in.
  const fallbackModelId = getEnv('NODE_MODEL_ID') ?? 'default-model';
  const fallbackContextWindow = config.maxTokens ?? 4096;
  let models: ModelInfo[] = [];

  try {
    models = await runner.listModels();
  } catch {
    models = [];
  }

  const normalized: Capability[] = models
    .filter((model) => Boolean(model?.id))
    .map((model): Capability => ({
      modelId: model.id ?? fallbackModelId,
      contextWindow: model.contextWindow ?? fallbackContextWindow,
      maxTokens: model.contextWindow ?? fallbackContextWindow,
      pricing: {
        unit: 'token',
        inputRate: 0,
        outputRate: 0,
        currency: 'USD',
      },
      latencyEstimateMs: config.capabilityLatencyMs,
      jobTypes: config.capabilityJobTypes,
    }));

  if (normalized.length > 0) {
    return normalized;
  }

  return [
    {
      modelId: fallbackModelId,
      contextWindow: fallbackContextWindow,
      maxTokens: fallbackContextWindow,
      pricing: {
        unit: 'token',
        inputRate: 0,
        outputRate: 0,
        currency: 'USD',
      },
      latencyEstimateMs: config.capabilityLatencyMs,
      jobTypes: config.capabilityJobTypes,
    },
  ];
}

async function startHeartbeat(
  service: ReturnType<typeof createNodeService>,
  config: NodeConfig,
) {
  const capabilities = await buildCapabilities(service.runner, config);

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
      const response = await fetch(`${config.routerEndpoint}/register-node`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(envelope),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        logWarn('heartbeat-rejected', {
          status: response.status,
          detail: detail.trim() ? detail.trim() : 'no-body',
        });
      } else {
        logInfo('heartbeat-sent', { nodeId: descriptor.nodeId });
      }
    } catch (error) {
      logWarn('heartbeat-send-failed', error);
    }
  };

  await sendHeartbeat();
  setInterval(sendHeartbeat, config.heartbeatIntervalMs);
}
