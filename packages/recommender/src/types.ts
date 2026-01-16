import type { CapabilityBands, BenchmarkProfile, HardwareProfile, NetworkProfile } from '@fed-ai/profiler';

export type OperatorIntent = {
  lowPower?: boolean;
  highEarnings?: boolean;
  privacyFirst?: boolean;
  reliabilityFirst?: boolean;
};

export type RecommendationInput = {
  hardware: HardwareProfile;
  network: NetworkProfile;
  bands: CapabilityBands;
  benchmarks?: BenchmarkProfile | null;
  intent?: OperatorIntent;
};

export type RecommendedRole = {
  role: string;
  rationale: string;
  limits: {
    maxConcurrency: number;
    maxPayloadBytes: number;
    maxTokens: number;
  };
};

export type RouterEligibility = {
  verdict: 'PASS' | 'FAIL';
  reasons: string[];
  mode: 'probation' | 'normal';
};

export type RecommendationResult = {
  nodeProfiles: RecommendedRole[];
  routerEligibility: RouterEligibility;
};
