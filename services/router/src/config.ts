export type RouterConfig = {
  routerId: string;
  keyId: string;
  endpoint: string;
  port: number;
  privateKey?: Uint8Array;
  nonceStorePath?: string;
  nonceStoreUrl?: string;
  maxRequestBytes?: number;
  paymentRequestRetentionMs?: number;
  paymentReceiptRetentionMs?: number;
  paymentReconcileIntervalMs?: number;
  paymentReconcileGraceMs?: number;
  routerFeeEnabled?: boolean;
  routerFeeSplitEnabled?: boolean;
  routerFeeBps?: number;
  routerFeeFlatSats?: number;
  routerFeeMinSats?: number;
  routerFeeMaxSats?: number;
  federationJobRetentionMs?: number;
  nodeHealthRetentionMs?: number;
  nodeCooldownRetentionMs?: number;
  nodeRetentionMs?: number;
  pruneIntervalMs?: number;
  schedulerTopK?: number;
  requirePayment: boolean;
  clientAllowList?: string[];
  clientBlockList?: string[];
  clientMuteList?: string[];
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
  tls?: RouterTlsConfig;
  paymentInvoice?: PaymentInvoiceConfig;
  paymentVerification?: PaymentVerificationConfig;
  statePath?: string;
  statePersistIntervalMs?: number;
  db?: RouterDbConfig;
  relayAdmission?: RelayAdmissionPolicy;
  federation?: RouterFederationConfig;
};

export type RouterTlsConfig = {
  certPath: string;
  keyPath: string;
  caPath?: string;
  requireClientCert?: boolean;
};

export type PaymentVerificationConfig = {
  url: string;
  timeoutMs?: number;
  requirePreimage?: boolean;
  retryMaxAttempts?: number;
  retryMinDelayMs?: number;
  retryMaxDelayMs?: number;
};

export type PaymentInvoiceConfig = {
  url: string;
  timeoutMs?: number;
  retryMaxAttempts?: number;
  retryMinDelayMs?: number;
  retryMaxDelayMs?: number;
  idempotencyHeader?: string;
};

export type RouterDbConfig = {
  url: string;
  ssl?: boolean;
};

export type RelayAdmissionPolicy = {
  requireSnapshot: boolean;
  maxAgeMs: number;
  minScore?: number;
  maxResults?: number;
};

export const defaultRelayAdmissionPolicy: RelayAdmissionPolicy = {
  requireSnapshot: false,
  maxAgeMs: 24 * 60 * 60 * 1000,
};

export const defaultRouterConfig: RouterConfig = {
  routerId: 'router-1',
  keyId: 'npub1r72drc4k609u2jwsgt5qy5at4aea9fsu8lqua4f20d26az9h80ms45kp92',
  endpoint: 'http://localhost:8080',
  port: 8080,
  maxRequestBytes: undefined,
  paymentRequestRetentionMs: 10 * 60 * 1000,
  paymentReceiptRetentionMs: 60 * 60 * 1000,
  paymentReconcileIntervalMs: 60_000,
  paymentReconcileGraceMs: 15_000,
  routerFeeEnabled: false,
  routerFeeSplitEnabled: true,
  routerFeeBps: 0,
  routerFeeFlatSats: 0,
  routerFeeMinSats: 0,
  routerFeeMaxSats: undefined,
  federationJobRetentionMs: 10 * 60 * 1000,
  nodeHealthRetentionMs: 60 * 60 * 1000,
  nodeCooldownRetentionMs: 10 * 60 * 1000,
  nodeRetentionMs: 10 * 60 * 1000,
  pruneIntervalMs: 30_000,
  schedulerTopK: 50,
  requirePayment: false,
  clientAllowList: undefined,
  clientBlockList: undefined,
  clientMuteList: undefined,
  rateLimitMax: undefined,
  rateLimitWindowMs: undefined,
  relayAdmission: defaultRelayAdmissionPolicy,
  federation: {
    enabled: false,
    endpoint: 'http://localhost:8080',
    requestTimeoutMs: 1000,
    publishConcurrency: 4,
    auctionConcurrency: 4,
    nostrEnabled: false,
    nostrRelays: undefined,
    nostrPublishIntervalMs: 30_000,
    nostrSubscribeSinceSeconds: 300,
    nostrAllowedPeers: undefined,
    nostrFollowPeers: undefined,
    nostrMutePeers: undefined,
    nostrBlockPeers: undefined,
    nostrMaxContentBytes: 16_384,
    nostrRelayRetryMinMs: 1_000,
    nostrRelayRetryMaxMs: 30_000,
    nostrWotEnabled: false,
    nostrWotTrustedPeers: undefined,
    nostrWotMinScore: 3,
    rateLimitMax: 60,
    rateLimitWindowMs: 10_000,
  },
};

export type RouterFederationConfig = {
  enabled: boolean;
  endpoint: string;
  maxSpendMsat?: number;
  maxOffloads?: number;
  maxPrivacyLevel?: 'PL0' | 'PL1' | 'PL2' | 'PL3';
  peers?: string[];
  publishIntervalMs?: number;
  requestTimeoutMs?: number;
  publishConcurrency?: number;
  auctionConcurrency?: number;
  nostrEnabled?: boolean;
  nostrRelays?: string[];
  nostrPublishIntervalMs?: number;
  nostrSubscribeSinceSeconds?: number;
  nostrAllowedPeers?: string[];
  nostrFollowPeers?: string[];
  nostrMutePeers?: string[];
  nostrBlockPeers?: string[];
  nostrMaxContentBytes?: number;
  nostrRelayRetryMinMs?: number;
  nostrRelayRetryMaxMs?: number;
  nostrWotEnabled?: boolean;
  nostrWotTrustedPeers?: string[];
  nostrWotMinScore?: number;
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
  discovery?: {
    enabled: boolean;
    bootstrapPeers?: string[];
  };
};
