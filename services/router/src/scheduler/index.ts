import type { SchedulingInput, SchedulingResult } from './types';

export const selectNode = (input: SchedulingInput): SchedulingResult => {
  if (input.nodes.length === 0) {
    return { selected: null, reason: 'no-nodes' };
  }

  return { selected: input.nodes[0] };
};
