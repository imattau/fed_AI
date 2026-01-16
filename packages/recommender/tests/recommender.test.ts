import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommend } from '../src/index';
import type { RecommendationInput } from '../src/types';

const input: RecommendationInput = {
  hardware: {
    cpu: { arch: 'x64', cores: 4, threads: 4, frequencyGHz: 2.5, flags: ['avx2'] },
    memory: { totalBytes: 8 * 1024 ** 3, availableBytes: 4 * 1024 ** 3 },
    disk: { type: 'ssd', freeBytes: 100 * 1024 ** 3 },
    gpu: { vendor: null, vramMb: null, runtime: { cuda: false, rocm: false } },
    os: { distro: 'linux', kernel: 'test' },
  },
  network: { interface: 'eth0', uploadMbps: null, downloadMbps: null, latencyMs: 50, jitterMs: 5 },
  bands: {
    cpu: 'cpu_mid',
    ram: 'ram_8',
    disk: 'disk_ssd',
    net: 'net_ok',
    gpu: 'gpu_none',
  },
  benchmarks: null,
};

test('recommend returns node profiles and router verdict', () => {
  const result = recommend(input);
  assert.ok(result.nodeProfiles.length > 0);
  assert.ok(['PASS', 'FAIL'].includes(result.routerEligibility.verdict));
});
