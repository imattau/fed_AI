import type { RouterJobType } from '@fed-ai/protocol';

export type NodeConfig = {
  nodeId: string;
  keyId: string;
  endpoint: string;
  routerEndpoint: string;
  routerKeyId?: string;
  routerAllowList?: string[];
  offloadPeers?: string[];
  offloadRouter?: boolean;
  offloadAuctionEnabled?: boolean;
  offloadAuctionMs?: number;
  offloadAuctionAllowList?: string[];
  offloadAuctionRateLimit?: number;
  heartbeatIntervalMs: number;
  runnerName: string;
  port: number;
  capacityMaxConcurrent: number;
  capacityCurrentLoad: number;
  maxPromptBytes?: number;
  maxTokens?: number;
  runnerTimeoutMs?: number;
  sandboxMode?: 'disabled' | 'restricted';
  sandboxAllowedRunners?: string[];
  sandboxAllowedEndpoints?: string[];
  maxRequestBytes?: number;
  maxInferenceMs?: number;
  requirePayment: boolean;
  privateKey?: Uint8Array;
  routerPublicKey?: Uint8Array;
  routerFollowList?: string[];
  routerMuteList?: string[];
  routerBlockList?: string[];
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
  nonceStorePath?: string;
  nonceStoreUrl?: string;
  tls?: NodeTlsConfig;
  paymentVerification?: PaymentVerificationConfig;
  routerFeeMaxBps?: number;
  routerFeeMaxSats?: number;
  pricingInputSats?: number;
  pricingOutputSats?: number;
  pricingUnit?: 'token' | 'second';
  capabilityJobTypes?: RouterJobType[];
  capabilityLatencyMs?: number;
};

export type NodeTlsConfig = {
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

export const defaultNodeConfig: NodeConfig = {
  nodeId: 'node-1',
  keyId: 'npub1r72drc4k609u2jwsgt5qy5at4aea9fsu8lqua4f20d26az9h80ms45kp92',
  endpoint: 'http://localhost:8081',
  routerEndpoint: 'http://localhost:8080',
  heartbeatIntervalMs: 10_000,
  runnerName: 'http',
  port: 8081,
  capacityMaxConcurrent: 4,
  capacityCurrentLoad: 0,
  maxPromptBytes: undefined,
  maxTokens: undefined,
  runnerTimeoutMs: undefined,
  sandboxMode: 'disabled',
  sandboxAllowedRunners: undefined,
  sandboxAllowedEndpoints: undefined,
  maxRequestBytes: undefined,
  maxInferenceMs: undefined,
  requirePayment: false,
  nonceStorePath: undefined,
  nonceStoreUrl: undefined,
  routerFollowList: undefined,
  routerMuteList: undefined,
  routerBlockList: undefined,
  rateLimitMax: undefined,
  rateLimitWindowMs: undefined,
  offloadPeers: undefined,
  offloadRouter: false,
  offloadAuctionEnabled: false,
  offloadAuctionMs: 800,
  offloadAuctionAllowList: undefined,
  offloadAuctionRateLimit: 30,
  tls: undefined,
  paymentVerification: undefined,
  routerFeeMaxBps: 1000,
  routerFeeMaxSats: 1000,
  pricingInputSats: 0,
  pricingOutputSats: 0,
  pricingUnit: 'token',
  capabilityJobTypes: undefined,
  capabilityLatencyMs: undefined,
};
