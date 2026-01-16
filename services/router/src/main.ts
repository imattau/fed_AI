import { parsePrivateKey } from '@fed-ai/protocol';
import { discoverRelays } from '@fed-ai/nostr-relay-discovery';
import { createRouterService } from './server';
import { defaultRouterConfig, RouterConfig } from './config';
import { createRouterHttpServer } from './http';

const getEnv = (key: string): string | undefined => {
  return process.env[key];
};

/** Parse comma-separated configurations such as relay URLs. */
const parseList = (value?: string): string[] | undefined => {
  return value
    ?.split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

/** Parse trust-score overrides in the form `url=score,url2=score`. */
const parseTrustScores = (value?: string): Record<string, number> | undefined => {
  if (!value) {
    return undefined;
  }

  const result: Record<string, number> = {};
  for (const pair of value.split(',')) {
    const [rawUrl, rawScore] = pair.split('=').map((item) => item.trim());
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

/** Coerce numeric CLI options; floats used for `minScore`, integers for limits. */
const parseNumber = (value?: string, float = false): number | undefined => {
  if (!value) {
    return undefined;
  }
  const parsed = float ? Number.parseFloat(value) : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** Build discovery options for the router using environment overrides. */
const buildDiscoveryOptions = () => ({
  bootstrapRelays: parseList(getEnv('ROUTER_RELAY_BOOTSTRAP')),
  aggregatorUrls: parseList(getEnv('ROUTER_RELAY_AGGREGATORS')),
  trustScores: parseTrustScores(getEnv('ROUTER_RELAY_TRUST')),
  minScore: parseNumber(getEnv('ROUTER_RELAY_MIN_SCORE'), true),
  maxResults: parseNumber(getEnv('ROUTER_RELAY_MAX_RESULTS')),
});

/** Log a short summary of the discovered relays so operators can audit the candidates. */
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

const buildConfig = (): RouterConfig => {
  const privateKey = getEnv('ROUTER_PRIVATE_KEY_PEM');

  return {
    ...defaultRouterConfig,
    routerId: getEnv('ROUTER_ID') ?? defaultRouterConfig.routerId,
    keyId: getEnv('ROUTER_KEY_ID') ?? defaultRouterConfig.keyId,
    endpoint: getEnv('ROUTER_ENDPOINT') ?? defaultRouterConfig.endpoint,
    port: Number(getEnv('ROUTER_PORT') ?? defaultRouterConfig.port),
    privateKey: privateKey ? parsePrivateKey(privateKey) : undefined,
    requirePayment: (getEnv('ROUTER_REQUIRE_PAYMENT') ?? 'false').toLowerCase() === 'true',
  };
};

const start = (): void => {
  const config = buildConfig();
  const service = createRouterService(config);
  const server = createRouterHttpServer(service, config);

  server.listen(config.port);
  void logRelayCandidates('router', buildDiscoveryOptions());
};

start();
