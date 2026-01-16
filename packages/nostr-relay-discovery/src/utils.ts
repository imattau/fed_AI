import type { RelayDescriptor } from './types';

/** Normalize host input, forcing wss/ ws schemes and rejecting invalid values. */
export function normalizeRelayUrl(raw: string): string {
  let working = raw.trim();
  if (!working) {
    throw new Error('empty relay url provided');
  }

  try {
    const parsed = new URL(working);
    if (parsed.protocol === 'http:') {
      parsed.protocol = 'ws:';
    } else if (parsed.protocol === 'https:') {
      parsed.protocol = 'wss:';
    }
    return parsed.toString();
  } catch (err) {
    if (!working.includes('://')) {
      working = `wss://${working}`;
      try {
        return new URL(working).toString();
      } catch (_err) {
        throw new Error(`invalid relay url "${raw}"`);
      }
    }
    throw new Error(`invalid relay url "${raw}"`);
  }
}

/** Convert raw score into a bounded priority used for secondary sorting. */
export function computePriority(score: number): number {
  const clamped = Math.max(0, Math.min(10, score));
  return parseFloat((clamped / 2).toFixed(1));
}

/** Merge updates into the descriptor map so duplicate URLs get aggregated metadata. */
export function mergeDescriptor(map: Map<string, RelayDescriptor>, descriptor: RelayDescriptor): void {
  const existing = map.get(descriptor.url);
  if (!existing) {
    map.set(descriptor.url, descriptor);
    return;
  }

  const merged: RelayDescriptor = {
    ...existing,
    ...descriptor,
    score: Math.max(existing.score, descriptor.score),
    priority: Math.max(existing.priority, descriptor.priority),
    tags: Array.from(new Set([...existing.tags, ...descriptor.tags])),
    lastSeenMs: Math.max(existing.lastSeenMs, descriptor.lastSeenMs),
  };

  map.set(descriptor.url, merged);
}
