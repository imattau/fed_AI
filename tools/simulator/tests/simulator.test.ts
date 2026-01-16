import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRng,
  generateNodes,
  generateRequests,
  runPricingSensitivity,
  runSimulation,
} from '../src/lib';

test('rng is deterministic for the same seed', () => {
  const rngA = createRng(123);
  const rngB = createRng(123);
  assert.equal(rngA(), rngB());
  assert.equal(rngA(), rngB());
});

test('generateNodes and generateRequests return expected counts', () => {
  const rng = createRng(7);
  assert.equal(generateNodes(3, rng).length, 3);
  assert.equal(generateRequests(4, rng).length, 4);
});

test('runSimulation returns metrics for zero requests', () => {
  const metrics = runSimulation({ nodes: 5, requests: 0, seed: 1 });
  assert.equal(metrics.totalRequests, 0);
  assert.equal(metrics.servedRequests, 0);
  assert.equal(metrics.dropRate, 0);
});

test('runPricingSensitivity returns result for each multiplier', () => {
  const report = runPricingSensitivity({ nodes: 5, requests: 10, seed: 2 }, [0.5, 1, 2]);
  assert.equal(report.results.length, 3);
  assert.equal(report.results[0].multiplier, 0.5);
});
