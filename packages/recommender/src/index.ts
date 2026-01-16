import type { CapabilityBands, BenchmarkProfile, HardwareProfile, NetworkProfile } from '@fed-ai/profiler';
import type {
  OperatorIntent,
  RecommendationInput,
  RecommendationResult,
  RecommendedRole,
  RouterEligibility,
} from './types';

const baseLimits = (concurrency: number, maxTokens: number): RecommendedRole['limits'] => ({
  maxConcurrency: concurrency,
  maxPayloadBytes: maxTokens * 6,
  maxTokens,
});

const recommendLowSpec = (bands: CapabilityBands): RecommendedRole[] => {
  const defaults = baseLimits(2, 256);
  return [
    { role: 'prepost_node', rationale: 'Low resource footprint for sanitise/format tasks.', limits: defaults },
    { role: 'policy_node', rationale: 'Simple policy and abuse checks on modest hardware.', limits: defaults },
    { role: 'cache_node', rationale: 'Cache and dedupe tasks fit small nodes.', limits: defaults },
    { role: 'registry_helper_node', rationale: 'Announcements and health updates are lightweight.', limits: defaults },
    ...(bands.cpu !== 'cpu_low'
      ? [{ role: 'embedding_node_small', rationale: 'CPU-friendly small embedding model.', limits: defaults }]
      : []),
  ];
};

const recommendHighSpec = (bands: CapabilityBands): RecommendedRole[] => {
  const roles: RecommendedRole[] = [];
  if (bands.cpu === 'cpu_high' && (bands.ram === 'ram_32' || bands.ram === 'ram_64_plus')) {
    roles.push({
      role: 'llm_cpu_small',
      rationale: 'Sufficient CPU and RAM for small quantised LLM inference.',
      limits: baseLimits(2, 1024),
    });
  }
  if (bands.gpu !== 'gpu_none') {
    roles.push({
      role: 'llm_gpu',
      rationale: 'GPU available for accelerated inference workloads.',
      limits: baseLimits(4, 2048),
    });
  }
  return roles;
};

const routerEligibility = (
  hardware: HardwareProfile,
  bands: CapabilityBands,
  benchmarks?: BenchmarkProfile | null,
): RouterEligibility => {
  const reasons: string[] = [];
  if (hardware.cpu.arch !== 'x64') {
    reasons.push('CPU architecture must be x86_64');
  }
  if (!hardware.cpu.flags.includes('avx2')) {
    reasons.push('CPU must support AVX2');
  }
  if (hardware.memory.totalBytes < 16 * 1024 ** 3) {
    reasons.push('Minimum 16GB RAM required');
  }
  if (bands.disk !== 'disk_ssd') {
    reasons.push('SSD required');
  }
  if (!benchmarks) {
    reasons.push('Benchmarks are required');
  }

  return {
    verdict: reasons.length === 0 ? 'PASS' : 'FAIL',
    reasons,
    mode: 'probation',
  };
};

export const recommend = (input: RecommendationInput): RecommendationResult => {
  const lowSpec = recommendLowSpec(input.bands);
  const highSpec = recommendHighSpec(input.bands);

  const nodeProfiles = [...lowSpec, ...highSpec];
  const router = routerEligibility(input.hardware, input.bands, input.benchmarks ?? null);

  return {
    nodeProfiles,
    routerEligibility: router,
  };
};

export type {
  CapabilityBands,
  HardwareProfile,
  NetworkProfile,
  BenchmarkProfile,
  OperatorIntent,
  RecommendationInput,
  RecommendationResult,
  RecommendedRole,
  RouterEligibility,
};
