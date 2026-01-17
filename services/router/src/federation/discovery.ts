export type FederationPeer = {
  url: string;
  source: 'config' | 'bootstrap';
};

const normalize = (value: string): string => value.replace(/\/+$/, '');

export const discoverFederationPeers = (
  peers: string[] | undefined,
  bootstrapPeers: string[] | undefined,
): FederationPeer[] => {
  const results: FederationPeer[] = [];
  for (const peer of peers ?? []) {
    results.push({ url: normalize(peer), source: 'config' });
  }
  for (const peer of bootstrapPeers ?? []) {
    results.push({ url: normalize(peer), source: 'bootstrap' });
  }
  const seen = new Set<string>();
  return results.filter((peer) => {
    if (seen.has(peer.url)) {
      return false;
    }
    seen.add(peer.url);
    return true;
  });
};
