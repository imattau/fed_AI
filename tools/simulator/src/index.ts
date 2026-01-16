import { formatMarkdownSummary, formatPricingSummary, runPricingSensitivity, runSimulation } from './lib';

const args = process.argv.slice(2);
const nodes = Number(args[0] ?? 50);
const requests = Number(args[1] ?? 500);
const seed = Number(args[2] ?? 42);
const scenario = args[3] ?? 'baseline';

const config = { nodes, requests, seed };

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
} else {
  const metrics = runSimulation(config);
  console.log(JSON.stringify(metrics, null, 2));
  console.log('\n---\n');
  console.log(formatMarkdownSummary(metrics));
}
