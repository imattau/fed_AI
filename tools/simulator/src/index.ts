import { formatMarkdownSummary, runSimulation } from './lib';

const args = process.argv.slice(2);
const config = {
  nodes: Number(args[0] ?? 50),
  requests: Number(args[1] ?? 500),
  seed: Number(args[2] ?? 42),
};

const metrics = runSimulation(config);

console.log(JSON.stringify(metrics, null, 2));
console.log('\n---\n');
console.log(formatMarkdownSummary(metrics));
