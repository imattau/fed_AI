# nostr-relay-discovery

Utility for discovering Nostr relays beyond the hard-coded bootstrap list.

## Features

- Normalises relay URLs and merges data from multiple aggregator directories.
- Applies configurable trust scores, scoring rules, and filtering knobs.
- Exposes a composable interface for routers, nodes, and CLIs to discover candidate relays for discovery and trust signals.

## Usage

```ts
import { discoverRelays } from '@fed-ai/nostr-relay-discovery';

const relays = await discoverRelays({
  trustScores: {
    'wss://trusted.relay': 5,
  },
  fetcher: customFetcher,
  minScore: 3,
});
```

The result is a sorted array of `RelayDescriptor` objects ready for downstream admission logic.

## Notes

- The package ships with a default fetcher that queries `https://rbr.bio/relays.json` and `https://relays.nostr.info/relays.json`.
- You can override the `fetcher`, `aggregatorUrls`, and `trustScores` to control discovery behaviour without touching the network.
- The package is intentionally light and easily testable, keeping the discovery logic separate from any specific service implementation.
