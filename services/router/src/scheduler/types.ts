import type { NodeDescriptor, QuoteRequest } from '@fed-ai/protocol';

export type SchedulingInput = {
  nodes: NodeDescriptor[];
  request: QuoteRequest;
};

export type SchedulingResult = {
  selected: NodeDescriptor | null;
  score?: number;
  reason?: string;
};
