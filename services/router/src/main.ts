import {
  decodeNpubToHex,
  derivePublicKeyHex,
  isNostrNpub,
  parsePrivateKey,
} from '@fed-ai/protocol';
import { existsSync, readFileSync } from 'node:fs';
import { discoverRelays } from '@fed-ai/nostr-relay-discovery';
import { createRouterService, hydrateRouterService } from './server';
import { defaultRelayAdmissionPolicy, defaultRouterConfig, RouterConfig } from './config';
import { createRouterHttpServer } from './http';
import { publishFederation } from './federation/publisher';
import { discoverFederationPeers } from './federation/discovery';
import { logInfo, logWarn } from './logging';
import { loadRouterState, startRouterStatePersistence } from './state';
import { createPostgresRouterStore } from './storage/postgres';
import { createPostgresNonceStore } from './storage/postgres-nonce';
import { FileNonceStore, InMemoryNonceStore, NonceStore } from '@fed-ai/protocol';
import { pruneRouterState } from './prune';
import { publishFederationToRelays, startFederationNostr } from './federation/nostr';
import { createFederationRateLimiter } from './federation/rate-limit';
import { createRateLimiter } from './rate-limit';
import { reconcilePayments } from './payments/reconcile';

const getEnv = (key: string): string | undefined => {
  return process.env[key];
};

const loadDynamicConfig = (): Partial<RouterConfig> & { adminNpub?: string } => {
  try {
    if (existsSync('config.json')) {
      const content = readFileSync('config.json', 'utf8');
      return JSON.parse(content);
    }
  } catch (e) {
    // ignore
  }
  return {};
};

const loadAdminIdentity = (): { adminNpub?: string } => {
  try {
    if (existsSync('admin-identity.json')) {
      const content = readFileSync('admin-identity.json', 'utf8');
      return JSON.parse(content);
    }
  } catch (e) {
    logWarn('[router] failed to load admin identity file', e);
  }
  return {};
};

const parseList = (value?: string): string[] | undefined => {
  return value
    ?.split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

const parseNpubList = (value?: string): string[] | undefined => {
  const entries = parseList(value);
  if (!entries) return undefined;
  const filtered = entries.filter((entry) => isNostrNpub(entry));
  return filtered.length > 0 ? filtered : undefined;
};

const parseTrustScores = (value?: string): Record<string, number> | undefined => {
  if (!value) return undefined;
  const result: Record<string, number> = {};
  for (const pair of value.split(',')) {
    const [rawUrl, rawScore] = pair.split('=').map((item) => item.trim());
    if (!rawUrl || !rawScore) continue;
    const score = Number.parseFloat(rawScore);
    if (Number.isFinite(score)) result[rawUrl] = score;
  }
  return Object.keys(result).length ? result : undefined;
};

const parseNumber = (value?: string, float = false): number | undefined => {
  if (!value) return undefined;
  const parsed = float ? Number.parseFloat(value) : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const buildDiscoveryOptions = () => ({
  bootstrapRelays: parseList(getEnv('ROUTER_RELAY_BOOTSTRAP')),
  aggregatorUrls: parseList(getEnv('ROUTER_RELAY_AGGREGATORS')),
  trustScores: parseTrustScores(getEnv('ROUTER_RELAY_TRUST')),
  minScore: parseNumber(getEnv('ROUTER_RELAY_MIN_SCORE'), true),
  maxResults: parseNumber(getEnv('ROUTER_RELAY_MAX_RESULTS')),
});

const buildRelayAdmissionPolicy = () => ({
  requireSnapshot: (getEnv('ROUTER_RELAY_SNAPSHOT_REQUIRED') ?? 'false').toLowerCase() === 'true',
  maxAgeMs: parseNumber(getEnv('ROUTER_RELAY_SNAPSHOT_MAX_AGE_MS')) ?? defaultRelayAdmissionPolicy.maxAgeMs,
  minScore: parseNumber(getEnv('ROUTER_RELAY_MIN_SCORE'), true),
  maxResults: parseNumber(getEnv('ROUTER_RELAY_MAX_RESULTS')),
});

const logRelayCandidates = async (role: string, options: Parameters<typeof discoverRelays>[0]): Promise<void> => {
  try {
    const relays = await discoverRelays(options);
    const snippet = relays.slice(0, 3).map((entry) => entry.url).join(', ') || 'none';
    logInfo(`[${role}] discovered ${relays.length} relays (top: ${snippet})`);
  } catch (error) {
    logWarn(`[${role}] relay discovery failed`, error);
  }
};

const buildConfig = (): RouterConfig => {
  const dynamic = loadDynamicConfig();
  const privateKey = getEnv('ROUTER_PRIVATE_KEY_PEM');
  const tlsCertPath = getEnv('ROUTER_TLS_CERT_PATH');
  const tlsKeyPath = getEnv('ROUTER_TLS_KEY_PATH');
  const tlsCaPath = getEnv('ROUTER_TLS_CA_PATH');
  const tlsRequireClientCert = (getEnv('ROUTER_TLS_REQUIRE_CLIENT_CERT') ?? 'false').toLowerCase() === 'true';
  const paymentVerifyUrl = getEnv('ROUTER_LN_VERIFY_URL');
  const paymentVerifyTimeoutMs = parseNumber(getEnv('ROUTER_LN_VERIFY_TIMEOUT_MS'));
  const paymentVerifyRetryMaxAttempts = parseNumber(getEnv('ROUTER_LN_VERIFY_RETRY_MAX_ATTEMPTS'));
  const paymentVerifyRetryMinDelayMs = parseNumber(getEnv('ROUTER_LN_VERIFY_RETRY_MIN_DELAY_MS'));
  const paymentVerifyRetryMaxDelayMs = parseNumber(getEnv('ROUTER_LN_VERIFY_RETRY_MAX_DELAY_MS'));
  const paymentRequirePreimage = (getEnv('ROUTER_LN_REQUIRE_PREIMAGE') ?? 'false').toLowerCase() === 'true';
  const paymentInvoiceUrl = getEnv('ROUTER_LN_INVOICE_URL');
  const paymentInvoiceTimeoutMs = parseNumber(getEnv('ROUTER_LN_INVOICE_TIMEOUT_MS'));
  const paymentInvoiceRetryMaxAttempts = parseNumber(getEnv('ROUTER_LN_INVOICE_RETRY_MAX_ATTEMPTS'));
  const paymentInvoiceRetryMinDelayMs = parseNumber(getEnv('ROUTER_LN_INVOICE_RETRY_MIN_DELAY_MS'));
  const paymentInvoiceRetryMaxDelayMs = parseNumber(getEnv('ROUTER_LN_INVOICE_RETRY_MAX_DELAY_MS'));
  const paymentInvoiceIdempotencyHeader = getEnv('ROUTER_LN_INVOICE_IDEMPOTENCY_HEADER');
  const statePersistIntervalMs = parseNumber(getEnv('ROUTER_STATE_PERSIST_MS'));
  const dbUrl = getEnv('ROUTER_DB_URL');
  const dbSsl = (getEnv('ROUTER_DB_SSL') ?? 'false').toLowerCase() === 'true';
  const nonceStoreUrl = getEnv('ROUTER_NONCE_STORE_URL');
  const maxRequestBytes = parseNumber(getEnv('ROUTER_MAX_REQUEST_BYTES'));
  const paymentRequestRetentionMs = parseNumber(getEnv('ROUTER_PAYMENT_REQUEST_RETENTION_MS'));
  const paymentReceiptRetentionMs = parseNumber(getEnv('ROUTER_PAYMENT_RECEIPT_RETENTION_MS'));
  const paymentReconcileIntervalMs = parseNumber(getEnv('ROUTER_PAYMENT_RECONCILE_INTERVAL_MS'));
  const paymentReconcileGraceMs = parseNumber(getEnv('ROUTER_PAYMENT_RECONCILE_GRACE_MS'));
  const routerFeeEnabled = (getEnv('ROUTER_FEE_ENABLED') ?? 'false').toLowerCase() === 'true';
  const routerFeeSplitEnabled = (getEnv('ROUTER_FEE_SPLIT') ?? 'true').toLowerCase() === 'true';
  const routerFeeBps = parseNumber(getEnv('ROUTER_FEE_BPS'));
  const routerFeeFlatSats = parseNumber(getEnv('ROUTER_FEE_FLAT_SATS'));
  const routerFeeMinSats = parseNumber(getEnv('ROUTER_FEE_MIN_SATS'));
  const routerFeeMaxSats = parseNumber(getEnv('ROUTER_FEE_MAX_SATS'));
  const federationJobRetentionMs = parseNumber(getEnv('ROUTER_FEDERATION_JOB_RETENTION_MS'));
  const nodeHealthRetentionMs = parseNumber(getEnv('ROUTER_NODE_HEALTH_RETENTION_MS'));
  const nodeCooldownRetentionMs = parseNumber(getEnv('ROUTER_NODE_COOLDOWN_RETENTION_MS'));
  const nodeRetentionMs = parseNumber(getEnv('ROUTER_NODE_RETENTION_MS'));
  const pruneIntervalMs = parseNumber(getEnv('ROUTER_PRUNE_INTERVAL_MS'));
  const schedulerTopK = parseNumber(getEnv('ROUTER_SCHEDULER_TOP_K'));
  const clientAllowList = parseNpubList(getEnv('ROUTER_CLIENT_ALLOWLIST'));
  const clientBlockList = parseNpubList(getEnv('ROUTER_CLIENT_BLOCKLIST'));
  const clientMuteList = parseNpubList(getEnv('ROUTER_CLIENT_MUTE'));
  const rateLimitMax = parseNumber(getEnv('ROUTER_RATE_LIMIT_MAX'));
  const rateLimitWindowMs = parseNumber(getEnv('ROUTER_RATE_LIMIT_WINDOW_MS'));
  const workerThreadsEnabled = (getEnv('ROUTER_WORKER_THREADS_ENABLED') ?? 'false').toLowerCase() === 'true';
  const workerThreadsMax = parseNumber(getEnv('ROUTER_WORKER_THREADS_MAX'));
  const workerThreadsQueueMax = parseNumber(getEnv('ROUTER_WORKER_THREADS_QUEUE_MAX'));
  const workerThreadsTimeoutMs = parseNumber(getEnv('ROUTER_WORKER_THREADS_TIMEOUT_MS'));
  const allowPrivateEndpoints = (getEnv('ROUTER_ALLOW_PRIVATE_ENDPOINTS') ?? 'false').toLowerCase() === 'true';
  const adminKey = getEnv('ROUTER_ADMIN_KEY');
  const adminIdentity = loadAdminIdentity();
  const adminNpub = getEnv('ROUTER_ADMIN_NPUB') ?? adminIdentity.adminNpub;

  return {
    ...defaultRouterConfig,
    routerId: getEnv('ROUTER_ID') ?? defaultRouterConfig.routerId,
    keyId: getEnv('ROUTER_KEY_ID') ?? defaultRouterConfig.keyId,
    endpoint: getEnv('ROUTER_ENDPOINT') ?? defaultRouterConfig.endpoint,
    port: Number(getEnv('ROUTER_PORT') ?? defaultRouterConfig.port),
    allowPrivateEndpoints, adminKey, adminNpub, maxRequestBytes,
    paymentRequestRetentionMs: paymentRequestRetentionMs ?? defaultRouterConfig.paymentRequestRetentionMs,
    paymentReceiptRetentionMs: paymentReceiptRetentionMs ?? defaultRouterConfig.paymentReceiptRetentionMs,
    paymentReconcileIntervalMs: paymentReconcileIntervalMs ?? defaultRouterConfig.paymentReconcileIntervalMs,
    paymentReconcileGraceMs: paymentReconcileGraceMs ?? defaultRouterConfig.paymentReconcileGraceMs,
    routerFeeEnabled, routerFeeSplitEnabled, routerFeeBps, routerFeeFlatSats, routerFeeMinSats, routerFeeMaxSats,
    federationJobRetentionMs: federationJobRetentionMs ?? defaultRouterConfig.federationJobRetentionMs,
    nodeHealthRetentionMs: nodeHealthRetentionMs ?? defaultRouterConfig.nodeHealthRetentionMs,
    nodeCooldownRetentionMs: nodeCooldownRetentionMs ?? defaultRouterConfig.nodeCooldownRetentionMs,
    nodeRetentionMs: nodeRetentionMs ?? defaultRouterConfig.nodeRetentionMs,
    pruneIntervalMs: pruneIntervalMs ?? defaultRouterConfig.pruneIntervalMs,
    schedulerTopK: schedulerTopK ?? defaultRouterConfig.schedulerTopK,
    clientAllowList, clientBlockList, clientMuteList, rateLimitMax, rateLimitWindowMs,
    workerThreads: { enabled: workerThreadsEnabled, maxWorkers: workerThreadsMax, maxQueue: workerThreadsQueueMax, taskTimeoutMs: workerThreadsTimeoutMs },
    privateKey: (() => { try { return privateKey ? parsePrivateKey(privateKey) : undefined; } catch { return undefined; } })(),
    nonceStorePath: getEnv('ROUTER_NONCE_STORE_PATH'),
    nonceStoreUrl,
    requirePayment: (getEnv('ROUTER_REQUIRE_PAYMENT') ?? 'false').toLowerCase() === 'true',
    tls: tlsCertPath && tlsKeyPath ? { certPath: tlsCertPath, keyPath: tlsKeyPath, caPath: tlsCaPath ?? undefined, requireClientCert: tlsRequireClientCert } : undefined,
    paymentVerification: paymentVerifyUrl ? { url: paymentVerifyUrl, timeoutMs: paymentVerifyTimeoutMs, requirePreimage: paymentRequirePreimage, retryMaxAttempts: paymentVerifyRetryMaxAttempts, retryMinDelayMs: paymentVerifyRetryMinDelayMs, retryMaxDelayMs: paymentVerifyRetryMaxDelayMs } : undefined,
    paymentInvoice: paymentInvoiceUrl ? { url: paymentInvoiceUrl, timeoutMs: paymentInvoiceTimeoutMs, retryMaxAttempts: paymentInvoiceRetryMaxAttempts, retryMinDelayMs: paymentInvoiceRetryMinDelayMs, retryMaxDelayMs: paymentInvoiceRetryMaxDelayMs, idempotencyHeader: paymentInvoiceIdempotencyHeader ?? undefined } : undefined,
    statePath: getEnv('ROUTER_STATE_PATH'), statePersistIntervalMs,
    db: dbUrl ? { url: dbUrl, ssl: dbSsl } : undefined,
    relayAdmission: buildRelayAdmissionPolicy(),
    federation: {
      enabled: (getEnv('ROUTER_FEDERATION_ENABLED') ?? 'false').toLowerCase() === 'true',
      endpoint: getEnv('ROUTER_FEDERATION_ENDPOINT') ?? defaultRouterConfig.endpoint,
      maxSpendMsat: parseNumber(getEnv('ROUTER_FEDERATION_MAX_SPEND_MSAT')),
      maxOffloads: parseNumber(getEnv('ROUTER_FEDERATION_MAX_OFFLOADS')),
      requestTimeoutMs: parseNumber(getEnv('ROUTER_FEDERATION_REQUEST_TIMEOUT_MS')),
      publishConcurrency: parseNumber(getEnv('ROUTER_FEDERATION_PUBLISH_CONCURRENCY')),
      auctionConcurrency: parseNumber(getEnv('ROUTER_FEDERATION_AUCTION_CONCURRENCY')),
      nostrEnabled: (getEnv('ROUTER_FEDERATION_NOSTR') ?? 'false').toLowerCase() === 'true',
      nostrRelays: parseList(getEnv('ROUTER_FEDERATION_NOSTR_RELAYS')),
      nostrPublishIntervalMs: parseNumber(getEnv('ROUTER_FEDERATION_NOSTR_PUBLISH_INTERVAL_MS')),
      nostrSubscribeSinceSeconds: parseNumber(getEnv('ROUTER_FEDERATION_NOSTR_SUBSCRIBE_SINCE_SEC')),
      nostrAllowedPeers: parseNpubList(getEnv('ROUTER_FEDERATION_NOSTR_ALLOWED_PEERS')),
      nostrFollowPeers: parseNpubList(getEnv('ROUTER_FEDERATION_NOSTR_FOLLOW')),
      nostrMutePeers: parseNpubList(getEnv('ROUTER_FEDERATION_NOSTR_MUTE')),
      nostrBlockPeers: parseNpubList(getEnv('ROUTER_FEDERATION_NOSTR_BLOCK')),
      nostrMaxContentBytes: parseNumber(getEnv('ROUTER_FEDERATION_NOSTR_MAX_CONTENT_BYTES')),
      nostrRelayRetryMinMs: parseNumber(getEnv('ROUTER_FEDERATION_NOSTR_RETRY_MIN_MS')),
      nostrRelayRetryMaxMs: parseNumber(getEnv('ROUTER_FEDERATION_NOSTR_RETRY_MAX_MS')),
      nostrWotEnabled: (getEnv('ROUTER_FEDERATION_NOSTR_WOT') ?? 'false').toLowerCase() === 'true',
      nostrWotTrustedPeers: parseNpubList(getEnv('ROUTER_FEDERATION_NOSTR_WOT_TRUSTED')),
      nostrWotMinScore: parseNumber(getEnv('ROUTER_FEDERATION_NOSTR_WOT_MIN_SCORE')),
      rateLimitMax: parseNumber(getEnv('ROUTER_FEDERATION_RATE_LIMIT_MAX')),
      rateLimitWindowMs: parseNumber(getEnv('ROUTER_FEDERATION_RATE_LIMIT_WINDOW_MS')),
      maxPrivacyLevel: getEnv('ROUTER_FEDERATION_MAX_PL') as 'PL0' | 'PL1' | 'PL2' | 'PL3' | undefined,
      peers: parseList(getEnv('ROUTER_FEDERATION_PEERS')),
      publishIntervalMs: parseNumber(getEnv('ROUTER_FEDERATION_PUBLISH_INTERVAL_MS')),
      discovery: { enabled: (getEnv('ROUTER_FEDERATION_DISCOVERY') ?? 'false').toLowerCase() === 'true', bootstrapPeers: parseList(getEnv('ROUTER_FEDERATION_BOOTSTRAP_PEERS')) },
    },
  };
};

const validateNostrIdentity = (keyId: string, privateKey?: Uint8Array): void => {
  if (!isNostrNpub(keyId)) throw new Error('router keyId must be a Nostr npub');
  if (privateKey) {
    const expected = decodeNpubToHex(keyId);
    const derived = derivePublicKeyHex(privateKey);
    if (expected !== derived) throw new Error('router private key does not match keyId');
  }
};

const validateConfig = (config: RouterConfig): string[] => {
  const issues: string[] = [];
  if (!config.keyId) issues.push('ROUTER_KEY_ID is required (npub).');
  else if (!isNostrNpub(config.keyId)) issues.push('ROUTER_KEY_ID must be a Nostr npub.');
  if (!config.privateKey) issues.push('ROUTER_PRIVATE_KEY_PEM (nsec/hex) is required to sign envelopes.');
  if (!config.endpoint) issues.push('ROUTER_ENDPOINT is required.');
  if (config.requirePayment) {
    if (!config.paymentInvoice) issues.push('ROUTER_LN_INVOICE_URL is required when ROUTER_REQUIRE_PAYMENT=true.');
    if (!config.paymentVerification) issues.push('ROUTER_LN_VERIFY_URL is required when ROUTER_REQUIRE_PAYMENT=true.');
  }
  return issues;
};

const start = async (): Promise<void> => {
  try {
    let config = buildConfig();
    const dynamic = loadDynamicConfig();
    config = { ...config, ...dynamic };

    const issues = validateConfig(config);
    if (issues.length > 0 || config.setupMode) {
      logWarn('[router] starting in SETUP MODE', { issues });
      config.setupMode = true;
      if (!config.keyId) config.keyId = 'npub1setup...';
      const service = createRouterService(config);
      const nonceStore = new InMemoryNonceStore();
      const federationRateLimiter = createFederationRateLimiter(config.federation);
      const ingressRateLimiter = createRateLimiter(config.rateLimitMax, config.rateLimitWindowMs);
      const server = createRouterHttpServer(service, config, nonceStore, federationRateLimiter, ingressRateLimiter);
      server.listen(config.port);
      logInfo(`[router] listening on ${config.port} (Setup Mode)`);
      return;
    }

    logInfo('[router] starting', { keyId: config.keyId, endpoint: config.endpoint });
    validateNostrIdentity(config.keyId, config.privateKey);
    const store = config.db ? await createPostgresRouterStore(config.db, { nodeRetentionMs: config.nodeRetentionMs, paymentRequestRetentionMs: config.paymentRequestRetentionMs, paymentReceiptRetentionMs: config.paymentReceiptRetentionMs, manifestRetentionMs: config.nodeRetentionMs, manifestAdmissionRetentionMs: config.nodeRetentionMs }) : undefined;
    const service = createRouterService(config, store);
    if (store) {
      try { const snapshot = await store.load(); hydrateRouterService(service, snapshot); }
      catch (error) { logWarn('[router] failed to hydrate store snapshot', error); }
    } else { loadRouterState(service, config.statePath); }
    
    let nonceStore: NonceStore = config.nonceStorePath ? new FileNonceStore(config.nonceStorePath) : new InMemoryNonceStore();
    if (config.nonceStoreUrl) {
      try { nonceStore = await createPostgresNonceStore(config.nonceStoreUrl); }
      catch (error) { logWarn('[router] failed to initialize nonce store', error); }
    } else if (!config.nonceStorePath) {
      logWarn('[router] using in-memory nonce store; replay protection will not persist across restarts');
    }

    const federationRateLimiter = createFederationRateLimiter(config.federation);
    const ingressRateLimiter = createRateLimiter(config.rateLimitMax, config.rateLimitWindowMs);
    const server = createRouterHttpServer(service, config, nonceStore, federationRateLimiter, ingressRateLimiter);

    server.listen(config.port);
    startRouterStatePersistence(service, config.statePath, config.statePersistIntervalMs);
    pruneRouterState(service, config);
    if (config.pruneIntervalMs && config.pruneIntervalMs > 0) { setInterval(() => { pruneRouterState(service, config); }, config.pruneIntervalMs); }
    if (config.paymentReconcileIntervalMs && config.paymentReconcileIntervalMs > 0) { const reconcile = () => reconcilePayments(service, config); reconcile(); setInterval(reconcile, config.paymentReconcileIntervalMs); }
    void logRelayCandidates('router', buildDiscoveryOptions());

    const discoveredPeers = discoverFederationPeers(config.federation?.peers, config.federation?.discovery?.bootstrapPeers);
    const peerUrls = discoveredPeers.map((peer) => peer.url);
    if (config.federation?.enabled && peerUrls.length > 0) {
      const intervalMs = config.federation.publishIntervalMs ?? 30_000;
      const publish = async () => { try { await publishFederation(service, config, peerUrls); } catch (error) { logWarn('[router] federation publish failed', error); } };
      void publish(); setInterval(publish, intervalMs);
    }

    if (config.federation?.enabled && config.federation.nostrEnabled) {
      let relayUrls = config.federation.nostrRelays ?? [];
      if (relayUrls.length === 0) { try { const relays = await discoverRelays(buildDiscoveryOptions()); relayUrls = relays.map((entry) => entry.url); } catch (error) { logWarn('[router] nostr relay discovery failed', error); } }
      if (relayUrls.length > 0 && config.privateKey) {
        const runtime = startFederationNostr(service, config, relayUrls, federationRateLimiter);
        const intervalMs = config.federation.nostrPublishIntervalMs ?? 30_000;
        const publish = async () => { try { await publishFederationToRelays(service, config, runtime); } catch (error) { logWarn('[router] nostr federation publish failed', error); } };
        void publish(); setInterval(publish, intervalMs);
      }
    }
  } catch (error) {
    logWarn('[router] fatal startup error', error);
    process.exit(1);
  }
};

void start();
