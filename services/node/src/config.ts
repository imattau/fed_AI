import type { RouterJobType } from '@fed-ai/protocol';

export type NodeConfig = {
  nodeId: string;
  keyId: string;
  endpoint: string;
  routerEndpoint: string;
  routerKeyId?: string;
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
  privateKey?: import('node:crypto').KeyObject;
  routerPublicKey?: import('node:crypto').KeyObject;
  nonceStorePath?: string;
  tls?: NodeTlsConfig;
  paymentVerification?: PaymentVerificationConfig;
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
};

export const defaultNodeConfig: NodeConfig = {
  nodeId: 'node-1',
  keyId: 'node-key-1',
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
  tls: undefined,
  paymentVerification: undefined,
  capabilityJobTypes: undefined,
  capabilityLatencyMs: undefined,
};
