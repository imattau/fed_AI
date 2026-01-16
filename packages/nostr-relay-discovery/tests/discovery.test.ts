import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discoverRelays } from '../src';

test('returns normalized bootstrap relays', async () => {
  const relays = await discoverRelays({
    bootstrapRelays: ['relay.example.com'],
    aggregatorUrls: [],
    fetcher: async () => ({}),
  });

  assert.equal(relays.length, 1);
  assert.equal(relays[0].url, 'wss://relay.example.com/');
});

test('merges aggregator entries with trust scores and filters', async () => {
  const fetcher = async () => ({
    relays: {
      'wss://fast.relay': { score: 8, write: false, tags: ['fast'] },
      'wss://slow.relay': { score: 2 },
    },
  });

  const relays = await discoverRelays({
    aggregatorUrls: ['https://example/relays.json'],
    fetcher,
    trustScores: {
      'wss://slow.relay': 5,
    },
    minScore: 5,
    bootstrapRelays: [],
  });

  assert.equal(relays.length, 2);
  assert(relays[0].url.includes('fast.relay'));
  assert(relays[0].tags.includes('fast'));
  assert(relays[1].score >= 5);
});

test('respects maxResults', async () => {
  const fetcher = async () => ({
    relays: [
      { url: 'wss://a.relay', score: 2 },
      { url: 'wss://b.relay', score: 2 },
      { url: 'wss://c.relay', score: 2 },
    ],
  });

  const relays = await discoverRelays({
    aggregatorUrls: ['https://example/relays.json'],
    fetcher,
    maxResults: 2,
  });

  assert.equal(relays.length, 2);
});
