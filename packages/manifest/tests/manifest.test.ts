import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { signManifest, verifyManifest } from '../src/index';
import type { NodeManifest } from '../src/types';

const baseManifest: NodeManifest = {
  id: 'node-1',
  role_types: ['prepost_node'],
  capability_bands: {
    cpu: 'cpu_mid',
    ram: 'ram_16',
    disk: 'disk_ssd',
    net: 'net_ok',
    gpu: 'gpu_none',
  },
  limits: { max_concurrency: 2, max_payload_bytes: 1024, max_tokens: 256 },
  supported_formats: ['text'],
  pricing_defaults: { unit: 'token', input_rate: 0, output_rate: 0, currency: 'USD' },
  benchmarks: null,
  software_version: '0.0.1',
};

test('signManifest and verifyManifest round-trip', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const signed = signManifest(baseManifest, 'node-key-1', privateKey) as NodeManifest;
  assert.equal(verifyManifest(signed, publicKey), true);
});
