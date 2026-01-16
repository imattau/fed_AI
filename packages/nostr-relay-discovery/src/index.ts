import { fetch } from 'undici';
import {
  DEFAULT_BOOTSTRAP_RELAYS,
  DEFAULT_DIRECTORY_URLS,
  DEFAULT_MAX_RESULTS,
  DEFAULT_MIN_SCORE,
} from './defaults';
import { computePriority, mergeDescriptor, normalizeRelayUrl } from './utils';
import type { DirectoryRelayEntry, DiscoveryOptions, RelayDescriptor, RelayFetcher } from './types';

/** Default HTTP fetcher used when no override is provided. */
const defaultFetcher: RelayFetcher = async (url, signal) => {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`unexpected status ${response.status} fetching ${url}`);
  }
  return response.json();
};

/** Normalize a custom trust-score map so keys match our normalized URLs. */
function normalizeTrustScores(trustScores?: Record<string, number>): Map<string, number> {
  const map = new Map<string, number>();
  if (!trustScores) {
    return map;
  }
  for (const [rawUrl, score] of Object.entries(trustScores)) {
    try {
      const normalized = normalizeRelayUrl(rawUrl);
      map.set(normalized, score);
    } catch (_err) {
      // ignore invalid trust entry
    }
  }
  return map;
}

/** Convert a directory entry into a RelayDescriptor with scoring applied. */
function toDescriptor(entry: DirectoryRelayEntry, trustMap: Map<string, number>, nowMs: number): RelayDescriptor | null {
  if (!entry.url) {
    return null;
  }

  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeRelayUrl(entry.url);
  } catch (err) {
    return null;
  }

  const trustBonus = trustMap.get(normalizedUrl) ?? 0;
  const baseScore = Math.max(1, entry.score ?? 5);
  const latencyPenalty = entry.latencyMs ? entry.latencyMs / 200 : 0;
  const score = Math.max(0, baseScore + trustBonus - latencyPenalty);
  const descriptor: RelayDescriptor = {
    url: normalizedUrl,
    read: entry.read ?? true,
    write: entry.write ?? true,
    score,
    priority: computePriority(score),
    tags: Array.isArray(entry.tags)
      ? entry.tags.filter((value): value is string => typeof value === 'string')
      : [],
    lastSeenMs: entry.lastSeenMs ?? nowMs,
  };

  if (typeof entry.latencyMs === 'number') {
    descriptor.latencyMs = entry.latencyMs;
  }

  return descriptor;
}

/** Try to extract relay entries from a JSON payload returned by a directory. */
function parseDirectoryPayload(payload: unknown): DirectoryRelayEntry[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const maybeMap = (payload as Record<string, unknown>)?.relays ?? (payload as Record<string, unknown>)?.entries ?? payload;

  if (Array.isArray(maybeMap)) {
    return maybeMap.flatMap((entry) => convertEntryValue(entry));
  }

  if (typeof maybeMap === 'object' && maybeMap !== null) {
    return Object.entries(maybeMap).flatMap(([key, value]) => convertEntryValue(value, key));
  }

  return [];
}

/** Helper that turns nested values into DirectoryRelayEntry instances. */
function convertEntryValue(value: unknown, fallbackUrl?: string): DirectoryRelayEntry[] {
  if (typeof value === 'string') {
    return [
      {
        url: value,
      },
    ];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => convertEntryValue(entry));
  }

  if (typeof value === 'object' && value !== null) {
    const entry = value as Record<string, unknown>;
    if (typeof entry.url === 'string') {
      return [castEntry(entry)];
    }
    if (fallbackUrl) {
      return [castEntry({ url: fallbackUrl, ...entry })];
    }
  }

  if (typeof value === 'boolean' && fallbackUrl) {
    return [
      {
        url: fallbackUrl,
        read: value,
        write: value,
      },
    ];
  }

  return [];
}

/** Cast a loosely typed object into the DirectoryRelayEntry shape. */
function castEntry(entry: Record<string, unknown>): DirectoryRelayEntry {
  return {
    url: entry.url as string,
    read: typeof entry.read === 'boolean' ? entry.read : undefined,
    write: typeof entry.write === 'boolean' ? entry.write : undefined,
    score: typeof entry.score === 'number' ? entry.score : undefined,
    tags: Array.isArray(entry.tags) ? entry.tags.filter((tag): tag is string => typeof tag === 'string') : undefined,
    latencyMs: typeof entry.latencyMs === 'number' ? entry.latencyMs : undefined,
    lastSeenMs: typeof entry.lastSeenMs === 'number' ? entry.lastSeenMs : undefined,
  };
}

/** Discover relays by merging bootstrap + directory sources, applying trust, and filtering results. */
export async function discoverRelays(options: DiscoveryOptions = {}): Promise<RelayDescriptor[]> {
  const now = Date.now();
  const trustMap = normalizeTrustScores(options.trustScores);
  const descriptors = new Map<string, RelayDescriptor>();
  const fetcher = options.fetcher ?? defaultFetcher;
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  const directories = options.aggregatorUrls ?? DEFAULT_DIRECTORY_URLS;
  const bootstrapRelays = options.bootstrapRelays ?? DEFAULT_BOOTSTRAP_RELAYS;

  for (const raw of bootstrapRelays) {
    const descriptor = toDescriptor({ url: raw }, trustMap, now);
    if (descriptor) {
      mergeDescriptor(descriptors, descriptor);
    }
  }

  await Promise.all(
    directories.map(async (directoryUrl) => {
      try {
        const payload = await fetcher(directoryUrl, options.signal);
        const entries = parseDirectoryPayload(payload);
        entries.forEach((entry) => {
          const descriptor = toDescriptor(entry, trustMap, now);
          if (descriptor) {
            mergeDescriptor(descriptors, descriptor);
          }
        });
      } catch (err) {
        options.logger?.(`failed to fetch relay directory ${directoryUrl}`, { error: err });
      }
    })
  );

  const merged = Array.from(descriptors.values()).filter((descriptor) => descriptor.score >= minScore);
  merged.sort((a, b) => {
    const primary = b.score - a.score;
    if (primary !== 0) {
      return primary;
    }
    return b.priority - a.priority;
  });

  if (typeof maxResults === 'number' && merged.length > maxResults) {
    return merged.slice(0, maxResults);
  }

  return merged;
}

export type { DiscoveryOptions, RelayDescriptor };
