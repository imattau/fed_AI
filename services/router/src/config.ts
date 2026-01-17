export type RouterConfig = {
  routerId: string;
  keyId: string;
  endpoint: string;
  port: number;
  privateKey?: import('node:crypto').KeyObject;
  requirePayment: boolean;
  relayAdmission?: RelayAdmissionPolicy;
  federation?: RouterFederationConfig;
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
  keyId: 'router-key-1',
  endpoint: 'http://localhost:8080',
  port: 8080,
  requirePayment: false,
  relayAdmission: defaultRelayAdmissionPolicy,
  federation: {
    enabled: false,
    endpoint: 'http://localhost:8080',
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
  discovery?: {
    enabled: boolean;
    bootstrapPeers?: string[];
  };
};
