import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRng,
  buildEndToEndConfig,
  runEndToEndSimulation,
  generateNodes,
  generateRequests,
  runPaymentFlowScenario,
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

test('runPaymentFlowScenario compares pay-before and pay-after', () => {
  const report = runPaymentFlowScenario({ nodes: 5, requests: 10, seed: 3 });
  assert.equal(report.flows.length, 2);
  const payBefore = report.flows.find((flow) => flow.flow === 'pay-before');
  const payAfter = report.flows.find((flow) => flow.flow === 'pay-after');
  assert.ok(payBefore);
  assert.ok(payAfter);
  assert.equal(payBefore?.receiptsPerRequest, 1);
  assert.equal(payAfter?.receiptsPerRequest, 2);
  assert.ok(payAfter!.dropRate >= payBefore!.dropRate);
});

test('runEndToEndSimulation returns report with federation metrics', () => {
  const base = { nodes: 9, requests: 10, seed: 4 };
  const config = buildEndToEndConfig(base, {
    routers: 3,
    nodesPerRouter: 3,
    auctionEnabled: true,
    bidVariance: 0.01,
  });
  const report = runEndToEndSimulation(config);
  assert.equal(report.baseConfig.routers, 3);
  assert.ok(report.metrics.federation.attempts >= 0);
  assert.ok(report.metrics.federation.bids >= 0);
  assert.ok(report.metrics.federation.awards >= 0);
  assert.equal(report.metrics.totalRequests, 10);
});
