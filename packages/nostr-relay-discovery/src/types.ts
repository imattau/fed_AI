/** RelayDescriptor captures the metadata we care about when ranking a candidate relay. */
export interface RelayDescriptor {
  url: string;
  read: boolean;
  write: boolean;
  priority: number; // 0-5 scale where higher values mean more trusted/weighted
  score: number; // raw score used for sorting and fallbacks
  tags: string[];
  lastSeenMs: number;
  latencyMs?: number; // optional observed latency hint
}

/** Parameters that influence directory polling, trust boosting, and filtering behavior. */
export interface DiscoveryOptions {
  bootstrapRelays?: string[];
  aggregatorUrls?: string[];
  trustScores?: Record<string, number>;
  minScore?: number;
  maxResults?: number;
  fetcher?: RelayFetcher;
  logger?: (message: string, detail?: unknown) => void;
  signal?: AbortSignal;
}

/** A raw entry parsed from a directory payload before normalization. */
export interface DirectoryRelayEntry {
  url: string;
  read?: boolean;
  write?: boolean;
  score?: number;
  tags?: string[];
  latencyMs?: number;
  lastSeenMs?: number;
}

export type RelayFetcher = (url: string, signal?: AbortSignal) => Promise<unknown>;
