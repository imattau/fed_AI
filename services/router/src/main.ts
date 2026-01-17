import { parsePrivateKey } from '@fed-ai/protocol';
import { discoverRelays } from '@fed-ai/nostr-relay-discovery';
import { createRouterService, hydrateRouterService } from './server';
import { defaultRelayAdmissionPolicy, defaultRouterConfig, RouterConfig } from './config';
import { createRouterHttpServer } from './http';
import { publishFederation } from './federation/publisher';
import { discoverFederationPeers } from './federation/discovery';
import { logInfo, logWarn } from './logging';
import { loadRouterState, startRouterStatePersistence } from './state';
import { createPostgresRouterStore } from './storage/postgres';

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

const buildRelayAdmissionPolicy = () => ({
  requireSnapshot:
    (getEnv('ROUTER_RELAY_SNAPSHOT_REQUIRED') ?? 'false').toLowerCase() === 'true',
  maxAgeMs: parseNumber(getEnv('ROUTER_RELAY_SNAPSHOT_MAX_AGE_MS')) ?? defaultRelayAdmissionPolicy.maxAgeMs,
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
    logInfo(`[${role}] discovered ${relays.length} relays (top: ${snippet})`);
  } catch (error) {
    logWarn(`[${role}] relay discovery failed`, error);
  }
};

const buildConfig = (): RouterConfig => {
  const privateKey = getEnv('ROUTER_PRIVATE_KEY_PEM');
  const tlsCertPath = getEnv('ROUTER_TLS_CERT_PATH');
  const tlsKeyPath = getEnv('ROUTER_TLS_KEY_PATH');
  const tlsCaPath = getEnv('ROUTER_TLS_CA_PATH');
  const tlsRequireClientCert =
    (getEnv('ROUTER_TLS_REQUIRE_CLIENT_CERT') ?? 'false').toLowerCase() === 'true';
  const paymentVerifyUrl = getEnv('ROUTER_LN_VERIFY_URL');
  const paymentVerifyTimeoutMs = parseNumber(getEnv('ROUTER_LN_VERIFY_TIMEOUT_MS'));
  const paymentRequirePreimage =
    (getEnv('ROUTER_LN_REQUIRE_PREIMAGE') ?? 'false').toLowerCase() === 'true';
  const paymentInvoiceUrl = getEnv('ROUTER_LN_INVOICE_URL');
  const paymentInvoiceTimeoutMs = parseNumber(getEnv('ROUTER_LN_INVOICE_TIMEOUT_MS'));
  const statePersistIntervalMs = parseNumber(getEnv('ROUTER_STATE_PERSIST_MS'));
  const dbUrl = getEnv('ROUTER_DB_URL');
  const dbSsl = (getEnv('ROUTER_DB_SSL') ?? 'false').toLowerCase() === 'true';

  return {
    ...defaultRouterConfig,
    routerId: getEnv('ROUTER_ID') ?? defaultRouterConfig.routerId,
    keyId: getEnv('ROUTER_KEY_ID') ?? defaultRouterConfig.keyId,
    endpoint: getEnv('ROUTER_ENDPOINT') ?? defaultRouterConfig.endpoint,
    port: Number(getEnv('ROUTER_PORT') ?? defaultRouterConfig.port),
    privateKey: privateKey ? parsePrivateKey(privateKey) : undefined,
    nonceStorePath: getEnv('ROUTER_NONCE_STORE_PATH'),
    requirePayment: (getEnv('ROUTER_REQUIRE_PAYMENT') ?? 'false').toLowerCase() === 'true',
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
    paymentInvoice: paymentInvoiceUrl
      ? {
          url: paymentInvoiceUrl,
          timeoutMs: paymentInvoiceTimeoutMs,
        }
      : undefined,
    statePath: getEnv('ROUTER_STATE_PATH'),
    statePersistIntervalMs,
    db: dbUrl ? { url: dbUrl, ssl: dbSsl } : undefined,
    relayAdmission: buildRelayAdmissionPolicy(),
    federation: {
      enabled: (getEnv('ROUTER_FEDERATION_ENABLED') ?? 'false').toLowerCase() === 'true',
      endpoint: getEnv('ROUTER_FEDERATION_ENDPOINT') ?? defaultRouterConfig.endpoint,
      maxSpendMsat: parseNumber(getEnv('ROUTER_FEDERATION_MAX_SPEND_MSAT')),
      maxOffloads: parseNumber(getEnv('ROUTER_FEDERATION_MAX_OFFLOADS')),
      maxPrivacyLevel: getEnv('ROUTER_FEDERATION_MAX_PL') as
        | 'PL0'
        | 'PL1'
        | 'PL2'
        | 'PL3'
        | undefined,
      peers: parseList(getEnv('ROUTER_FEDERATION_PEERS')),
      publishIntervalMs: parseNumber(getEnv('ROUTER_FEDERATION_PUBLISH_INTERVAL_MS')),
      discovery: {
        enabled: (getEnv('ROUTER_FEDERATION_DISCOVERY') ?? 'false').toLowerCase() === 'true',
        bootstrapPeers: parseList(getEnv('ROUTER_FEDERATION_BOOTSTRAP_PEERS')),
      },
    },
  };
};

const start = async (): Promise<void> => {
  const config = buildConfig();
  const store = config.db ? await createPostgresRouterStore(config.db) : undefined;
  const service = createRouterService(config, store);
  if (store) {
    try {
      const snapshot = await store.load();
      hydrateRouterService(service, snapshot);
    } catch (error) {
      logWarn('[router] failed to hydrate store snapshot', error);
    }
  } else {
    loadRouterState(service, config.statePath);
  }
  const server = createRouterHttpServer(service, config);

  server.listen(config.port);
  startRouterStatePersistence(service, config.statePath, config.statePersistIntervalMs);
  void logRelayCandidates('router', buildDiscoveryOptions());

  const discoveredPeers = discoverFederationPeers(
    config.federation?.peers,
    config.federation?.discovery?.bootstrapPeers,
  );
  const peerUrls = discoveredPeers.map((peer) => peer.url);
  if (config.federation?.enabled && peerUrls.length > 0) {
    const intervalMs = config.federation.publishIntervalMs ?? 30_000;
    const publish = async () => {
      try {
        await publishFederation(service, config, peerUrls);
      } catch (error) {
        logWarn('[router] federation publish failed', error);
      }
    };
    void publish();
    setInterval(publish, intervalMs);
  }
};

void start();
