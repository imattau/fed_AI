import { Counter, collectDefaultMetrics, Histogram, Registry } from 'prom-client';
import { trace } from '@opentelemetry/api';

export const nodeRegistry = new Registry();
collectDefaultMetrics({ register: nodeRegistry });

export const nodeInferenceRequests = new Counter({
  name: 'node_inference_requests_total',
  help: 'Total inference requests received by the node',
  labelNames: ['status'],
  registers: [nodeRegistry],
});

export const nodeInferenceDuration = new Histogram({
  name: 'node_inference_duration_seconds',
  help: 'Duration of inference handling on the node',
  buckets: [0.005, 0.01, 0.05, 0.1, 0.3, 1],
  registers: [nodeRegistry],
});

export const nodeReceiptFailures = new Counter({
  name: 'node_payment_receipt_failures_total',
  help: 'Invalid or missing payment receipts observed by the node',
  registers: [nodeRegistry],
});

export const nodeTracer = trace.getTracer('node');
