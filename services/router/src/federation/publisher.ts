import type {
  RouterCapabilityProfile,
  RouterControlMessage,
  RouterPriceSheet,
  RouterStatusPayload,
} from '@fed-ai/protocol';
import { signRouterMessage } from '@fed-ai/protocol';
import type { RouterConfig } from '../config';
import type { RouterService } from '../server';

export type FederationPublishResult = {
  peer: string;
  endpoint: string;
  ok: boolean;
  status: number;
};

type Fetcher = typeof fetch;

const withTimeout = (timeoutMs?: number): { signal?: AbortSignal; cancel: () => void } => {
  if (!timeoutMs || timeoutMs <= 0) {
    return { cancel: () => undefined };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
};

const runWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  handler: (item: T) => Promise<R>,
): Promise<R[]> => {
  if (items.length === 0) {
    return [];
  }
  if (limit <= 0) {
    return Promise.all(items.map((item) => handler(item)));
  }
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await handler(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
};

const buildMessage = <T>(
  type: RouterControlMessage<T>['type'],
  routerId: string,
  payload: T,
  messageId: string,
  expiry: number,
  privateKey: NonNullable<RouterConfig['privateKey']>,
): RouterControlMessage<T> => {
  const message: RouterControlMessage<T> = {
    type,
    version: '0.1',
    routerId,
    messageId,
    timestamp: Date.now(),
    expiry,
    payload,
    sig: '',
  };
  return signRouterMessage(message, privateKey);
};

const postMessage = async (
  fetcher: Fetcher,
  peer: string,
  endpoint: string,
  message: RouterControlMessage<unknown>,
  timeoutMs?: number,
): Promise<FederationPublishResult> => {
  const { signal, cancel } = withTimeout(timeoutMs);
  try {
    const response = await fetcher(`${peer}${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(message),
      signal,
    });
    return { peer, endpoint, ok: response.ok, status: response.status };
  } catch {
    return { peer, endpoint, ok: false, status: 0 };
  } finally {
    cancel();
  }
};

export const publishFederation = async (
  service: RouterService,
  config: RouterConfig,
  peers: string[],
  fetcher: Fetcher = fetch,
): Promise<FederationPublishResult[]> => {
  if (!config.federation?.enabled || !config.privateKey) {
    return [];
  }
  const routerId = config.keyId;
  const results: FederationPublishResult[] = [];
  const timeoutMs = config.federation.requestTimeoutMs;
  const concurrency = config.federation.publishConcurrency ?? 4;

  const caps = service.federation.localCapabilities;
  if (caps) {
    const message = buildMessage<RouterCapabilityProfile>(
      'CAPS_ANNOUNCE',
      routerId,
      caps,
      `${routerId}:caps:${caps.timestamp}`,
      caps.expiry,
      config.privateKey,
    );
    const capsResults = await runWithConcurrency(
      peers,
      concurrency,
      (peer) => postMessage(fetcher, peer, '/federation/caps', message, timeoutMs),
    );
    results.push(...capsResults);
  }

  const status = service.federation.localStatus;
  if (status) {
    const message = buildMessage<RouterStatusPayload>(
      'STATUS_ANNOUNCE',
      routerId,
      status,
      `${routerId}:status:${status.timestamp}`,
      status.expiry,
      config.privateKey,
    );
    const statusResults = await runWithConcurrency(
      peers,
      concurrency,
      (peer) => postMessage(fetcher, peer, '/federation/status', message, timeoutMs),
    );
    results.push(...statusResults);
  }

  for (const price of service.federation.localPriceSheets.values()) {
    const message = buildMessage<RouterPriceSheet>(
      'PRICE_ANNOUNCE',
      routerId,
      price,
      `${routerId}:price:${price.jobType}:${price.timestamp}`,
      price.expiry,
      config.privateKey,
    );
    const priceResults = await runWithConcurrency(
      peers,
      concurrency,
      (peer) => postMessage(fetcher, peer, '/federation/price', message, timeoutMs),
    );
    results.push(...priceResults);
  }

  return results;
};

export type FederationAuctionBid = {
  peer: string;
  bid: RouterControlMessage<import('@fed-ai/protocol').RouterBidPayload>;
};

export type FederationAuctionResult = {
  jobId: string;
  bids: FederationAuctionBid[];
  winner?: FederationAuctionBid;
};

export const runFederationAuction = async (
  config: RouterConfig,
  peers: string[],
  rfb: RouterControlMessage<import('@fed-ai/protocol').RouterRfbPayload>,
  fetcher: Fetcher = fetch,
): Promise<FederationAuctionResult> => {
  if (!config.federation?.enabled || !config.privateKey) {
    return { jobId: rfb.payload.jobId, bids: [] };
  }
  const timeoutMs = config.federation.requestTimeoutMs;
  const concurrency = config.federation.auctionConcurrency ?? 4;
  const bidResults = await runWithConcurrency(peers, concurrency, async (peer) => {
    const { signal, cancel } = withTimeout(timeoutMs);
    try {
      const response = await fetcher(`${peer}/federation/rfb`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(rfb),
        signal,
      });
      if (!response.ok) {
        return null;
      }
      const parsed = (await response.json()) as {
        bid?: RouterControlMessage<import('@fed-ai/protocol').RouterBidPayload>;
      };
      if (parsed?.bid && parsed.bid.type === 'BID') {
        return { peer, bid: parsed.bid };
      }
      return null;
    } catch {
      return null;
    } finally {
      cancel();
    }
  });

  const bids = bidResults.filter((entry): entry is FederationAuctionBid => entry !== null);
  bids.sort((a, b) => a.bid.payload.priceMsat - b.bid.payload.priceMsat);
  const winner = bids[0];
  return { jobId: rfb.payload.jobId, bids, winner };
};

export const selectAwardFromBids = (
  config: RouterConfig,
  rfb: RouterControlMessage<import('@fed-ai/protocol').RouterRfbPayload>,
  bids: RouterControlMessage<import('@fed-ai/protocol').RouterBidPayload>[],
  winnerRouterId: string,
): RouterControlMessage<import('@fed-ai/protocol').RouterAwardPayload> | null => {
  if (!config.privateKey) {
    return null;
  }
  const winner = bids.find((bid) => bid.routerId === winnerRouterId);
  if (!winner) {
    return null;
  }
  const payload: import('@fed-ai/protocol').RouterAwardPayload = {
    jobId: rfb.payload.jobId,
    winnerRouterId,
    acceptedPriceMsat: winner.payload.priceMsat,
    awardExpiry: rfb.payload.deadlineMs,
    awardHash: winner.payload.bidHash,
  };
  const message: RouterControlMessage<import('@fed-ai/protocol').RouterAwardPayload> = {
    type: 'AWARD',
    version: '0.1',
    routerId: config.keyId,
    messageId: `${config.keyId}:${payload.jobId}:${Date.now()}`,
    timestamp: Date.now(),
    expiry: rfb.expiry,
    payload,
    sig: '',
  };
  return signRouterMessage(message, config.privateKey);
};

export const publishAward = async (
  config: RouterConfig,
  peer: string,
  award: RouterControlMessage<import('@fed-ai/protocol').RouterAwardPayload>,
  fetcher: Fetcher = fetch,
): Promise<FederationPublishResult> => {
  if (!config.federation?.enabled || !config.privateKey) {
    return { peer, endpoint: '/federation/award', ok: false, status: 503 };
  }
  return postMessage(fetcher, peer, '/federation/award', award);
};

export const runAuctionAndAward = async (
  config: RouterConfig,
  peers: string[],
  rfb: RouterControlMessage<import('@fed-ai/protocol').RouterRfbPayload>,
  fetcher: Fetcher = fetch,
): Promise<{
  award?: RouterControlMessage<import('@fed-ai/protocol').RouterAwardPayload>;
  winnerPeer?: string;
}> => {
  const auction = await runFederationAuction(config, peers, rfb, fetcher);
  if (!auction.winner) {
    return {};
  }
  const award = selectAwardFromBids(
    config,
    rfb,
    auction.bids.map((entry) => entry.bid),
    auction.winner.bid.routerId,
  );
  if (!award) {
    return {};
  }
  await publishAward(config, auction.winner.peer, award, fetcher);
  return { award, winnerPeer: auction.winner.peer };
};
