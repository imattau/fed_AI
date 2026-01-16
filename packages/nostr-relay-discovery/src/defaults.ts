/** Fall-back relays that are safe to ship with the agent so bootstrapping never depends on unknown directories. */
export const DEFAULT_BOOTSTRAP_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.snort.social',
  'wss://eden.nostr.land',
  'wss://relay.nostr.info',
  'wss://rbr.bio'
];

/** Public aggregator endpoints that supply JSON lists of relay metadata. */
export const DEFAULT_DIRECTORY_URLS = [
  'https://rbr.bio/relays.json',
  'https://relays.nostr.info/relays.json'
];

export const DEFAULT_MIN_SCORE = 1;
export const DEFAULT_MAX_RESULTS = 25;
