import type { SchedulingInput, SchedulingResult } from './types';
import { scoreNode } from './score';

export { scoreNode };

export const selectNode = (input: SchedulingInput): SchedulingResult => {
  if (input.nodes.length === 0) {
    return { selected: null, reason: 'no-nodes' };
  }

  let best: SchedulingResult = { selected: null, reason: 'no-capable-nodes' };

  for (const node of input.nodes) {
    const score = scoreNode(node, input.request);
    if (score === null) {
      continue;
    }
    if (!best.selected || (best.score ?? -Infinity) < score) {
      best = { selected: node, score };
    }
  }

  return best;
};
