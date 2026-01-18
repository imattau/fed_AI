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

export const accountingFailures = new Counter({
  name: 'router_accounting_failures_total',
  help: 'Accounting-related failures observed by the router',
  labelNames: ['reason'],
  registers: [routerRegistry],
});

export const federationMessages = new Counter({
  name: 'router_federation_messages_total',
  help: 'Federation control-plane messages accepted',
  labelNames: ['type'],
  registers: [routerRegistry],
});

export const federationJobs = new Counter({
  name: 'router_federation_jobs_total',
  help: 'Federation data-plane jobs processed',
  labelNames: ['stage'],
  registers: [routerRegistry],
});

export const federationRelayFailures = new Counter({
  name: 'router_federation_relay_failures_total',
  help: 'Federation relay publish/subscribe failures',
  labelNames: ['stage'],
  registers: [routerRegistry],
});
