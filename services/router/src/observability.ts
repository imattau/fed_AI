import { Counter, collectDefaultMetrics, Histogram, Registry } from 'prom-client';
import { trace } from '@opentelemetry/api';

export const routerRegistry = new Registry();
collectDefaultMetrics({ register: routerRegistry });

export const inferenceRequests = new Counter({
  name: 'router_inference_requests_total',
  help: 'Total inference HTTP requests handled by the router',
  labelNames: ['status'],
  registers: [routerRegistry],
});

export const inferenceDuration = new Histogram({
  name: 'router_inference_duration_seconds',
  help: 'Inference handler duration in seconds',
  buckets: [0.005, 0.01, 0.05, 0.1, 0.3, 1, 3],
  registers: [routerRegistry],
});

export const paymentRequests = new Counter({
  name: 'router_payment_requests_total',
  help: 'Payment challenges issued by the router',
  registers: [routerRegistry],
});

export const paymentReceiptFailures = new Counter({
  name: 'router_payment_receipt_failures_total',
  help: 'Failed payment receipt verifications',
  registers: [routerRegistry],
});

export const routerTracer = trace.getTracer('router');

export const nodeFailureEvents = new Counter({
  name: 'router_node_failures_total',
  help: 'Node failure events counted by the router',
  labelNames: ['nodeId'],
  registers: [routerRegistry],
});
