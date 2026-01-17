import {
  buildEndToEndConfig,
  formatEndToEndSummary,
  formatMarkdownSummary,
  formatPricingSummary,
  runEndToEndSimulation,
  runPaymentFlowScenario,
  runPricingSensitivity,
  runSimulation,
} from './lib';

const args = process.argv.slice(2);
const nodes = Number(args[0] ?? 50);
const requests = Number(args[1] ?? 500);
const seed = Number(args[2] ?? 42);
const scenario = args[3] ?? 'baseline';

const config = { nodes, requests, seed };
const parseFlags = (values: string[]): Record<string, string> => {
  const result: Record<string, string> = {};
  for (let i = 0; i < values.length; i += 1) {
    const token = values[i];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const value = values[i + 1];
    if (value === undefined || value.startsWith('--')) {
      result[key] = 'true';
    } else {
      result[key] = value;
      i += 1;
    }
  }
  return result;
};

if (scenario === 'pricing') {
  const multipliers = (args[4] ?? '0.5,1,2')
    .split(',')
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  const report = runPricingSensitivity(config, multipliers);
  console.log(JSON.stringify(report, null, 2));
  console.log('\n---\n');
  console.log(formatPricingSummary(report));
} else if (scenario === 'payments') {
  const report = runPaymentFlowScenario(config);
  console.log(JSON.stringify(report, null, 2));
  console.log('\n---\n');
  console.log(`# Payment Flow Summary`);
  for (const flow of report.flows) {
    console.log(
      `- ${flow.flow}: receipts=${flow.receiptsPerRequest}, drop=${(flow.dropRate * 100).toFixed(
        2,
      )}%, extra-latency=${flow.extraLatencyMs}ms`,
    );
  }
} else if (scenario === 'e2e' || scenario === 'end-to-end') {
  const flags = parseFlags(args.slice(4));
  const endToEndConfig = buildEndToEndConfig(config, {
    routers: Number(flags.routers ?? 3),
    nodesPerRouter: Number(flags['nodes-per-router'] ?? Math.max(1, Math.floor(nodes / 3))),
    federationEnabled: (flags.federation ?? 'true') === 'true',
    auctionEnabled: (flags.auction ?? 'false') === 'true',
    auctionTimeoutMs: Number(flags['auction-timeout-ms'] ?? 500),
    bidVariance: Number(flags['bid-variance'] ?? 0.02),
    paymentFlow: (flags['payment-flow'] as 'pay-before' | 'pay-after') ?? 'pay-before',
    maxOffloads: Number(flags['max-offloads'] ?? 5),
    offloadThreshold: Number(flags['offload-threshold'] ?? 0.75),
    nodeFailureRate: Number(flags['node-failure-rate'] ?? 0.03),
    paymentFailureRate: Number(flags['payment-failure-rate'] ?? 0.02),
    receiptFailureRate: Number(flags['receipt-failure-rate'] ?? 0.01),
  });

  const report = runEndToEndSimulation(endToEndConfig);
  console.log(JSON.stringify(report, null, 2));
  console.log('\n---\n');
  console.log(formatEndToEndSummary(report));
} else {
  const metrics = runSimulation(config);
  console.log(JSON.stringify(metrics, null, 2));
  console.log('\n---\n');
  console.log(formatMarkdownSummary(metrics));
}
