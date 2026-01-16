import type { BenchmarkProfile, CapabilityBands } from '@fed-ai/profiler';
import type { RelayDescriptor } from '@fed-ai/nostr-relay-discovery';

export type ManifestSignature = {
  signature: string;
  keyId: string;
  signedAtMs: number;
};

export type RelayDiscoverySnapshot = {
  discoveredAtMs: number;
  relays: RelayDescriptor[];
  options: {
    bootstrapRelays?: string[];
    aggregatorUrls?: string[];
    trustScores?: Record<string, number>;
    minScore?: number;
    maxResults?: number;
  };
};

export type NodeManifest = {
  id: string;
  role_types: string[];
  capability_bands: CapabilityBands;
  limits: {
    max_concurrency: number;
    max_payload_bytes: number;
    max_tokens: number;
  };
  supported_formats: string[];
  pricing_defaults: {
    unit: 'token' | 'call';
    input_rate: number;
    output_rate?: number;
    currency: string;
  };
  benchmarks: BenchmarkProfile | null;
  software_version: string;
  signature?: ManifestSignature;
  relay_discovery?: RelayDiscoverySnapshot | null;
};

export type RouterManifest = {
  id: string;
  router_mode: 'probation' | 'normal';
  capability_bands: CapabilityBands;
  limits: {
    max_qps: number;
    max_concurrent_jobs: number;
    max_payload_bytes: number;
  };
  policies_enabled: string[];
  audit_mode: 'off' | 'basic' | 'verbose';
  benchmarks: BenchmarkProfile | null;
  software_version: string;
  signature?: ManifestSignature;
  relay_discovery?: RelayDiscoverySnapshot | null;
};
