import type { Event as NostrEvent, Filter } from 'nostr-tools';
import { SimplePool, useWebSocketImplementation } from 'nostr-tools';
import WebSocket from 'ws';
import {
  buildRouterControlEvent,
  parseRouterControlEvent,
  ROUTER_NOSTR_KINDS,
  validateRouterAwardPayload,
  validateRouterBidPayload,
  validateRouterCapabilityProfile,
  validateRouterPriceSheet,
  validateRouterRfbPayload,
  validateRouterStatusPayload,
} from '@fed-ai/protocol';
import type {
  RouterAwardPayload,
  RouterBidPayload,
  RouterCapabilityProfile,
  RouterControlMessage,
  RouterPriceSheet,
  RouterRfbPayload,
  RouterStatusPayload,
} from '@fed-ai/protocol';
import type { RouterConfig } from '../config';
import type { RouterService } from '../server';
import { logInfo, logWarn } from '../logging';
import { federationMessages, federationRelayFailures } from '../observability';
import { canBidForRfb, estimateBidPrice } from './logic';
import type { FederationRateLimiter } from './rate-limit';
import { createFederationRelayManager } from './relay-manager';

useWebSocketImplementation(WebSocket);

export type FederationNostrRuntime = {
  pool: SimplePool;
  relays: string[];
  peerScores: Map<string, number>;
  relayManager: ReturnType<typeof createFederationRelayManager>;
  close: () => void;
};

const buildMessage = <T>(
  type: RouterControlMessage<T>['type'],
  routerId: string,
  payload: T,
  messageId: string,
  expiry: number,
): RouterControlMessage<T> => ({
  type,
  version: '0.1',
  routerId,
  messageId,
  timestamp: Date.now(),
  expiry,
  payload,
  sig: '',
});

const publishEvent = async (
  pool: SimplePool,
  relays: string[],
  event: NostrEvent,
  relayManager: ReturnType<typeof createFederationRelayManager>,
): Promise<void> => {
  const results = pool.publish(relays, event);
  const settled = await Promise.allSettled(results);
  for (const [index, result] of settled.entries()) {
    const relay = relays[index];
    if (result.status === 'rejected') {
      federationRelayFailures.inc({ stage: 'publish' });
      if (relay) {
        relayManager.recordFailure(relay);
      }
    } else if (relay) {
      relayManager.recordSuccess(relay);
    }
  }
};

const publishLocalMessages = async (
  service: RouterService,
  config: RouterConfig,
  runtime: FederationNostrRuntime,
): Promise<void> => {
  if (!config.privateKey) {
    return;
  }
  const routerId = config.keyId;
  const events: NostrEvent[] = [];

  const caps = service.federation.localCapabilities;
  if (caps && caps.routerId === routerId) {
    const message = buildMessage<RouterCapabilityProfile>(
      'CAPS_ANNOUNCE',
      routerId,
      caps,
      `${routerId}:caps:${caps.timestamp}`,
      caps.expiry,
    );
    events.push(buildRouterControlEvent(message, config.privateKey));
  }

  const status = service.federation.localStatus;
  if (status && status.routerId === routerId) {
    const message = buildMessage<RouterStatusPayload>(
      'STATUS_ANNOUNCE',
      routerId,
      status,
      `${routerId}:status:${status.timestamp}`,
      status.expiry,
    );
    events.push(buildRouterControlEvent(message, config.privateKey));
  }

  for (const price of service.federation.localPriceSheets.values()) {
    if (price.routerId !== routerId) {
      continue;
    }
    const message = buildMessage<RouterPriceSheet>(
      'PRICE_ANNOUNCE',
      routerId,
      price,
      `${routerId}:price:${price.jobType}:${price.timestamp}`,
      price.expiry,
    );
    events.push(buildRouterControlEvent(message, config.privateKey));
  }

  await Promise.all(events.map((event) => publishEvent(runtime.pool, runtime.relays, event, runtime.relayManager)));
};

const handleCaps = (service: RouterService, message: RouterControlMessage<RouterCapabilityProfile>): void => {
  service.federation.capabilities = message.payload;
  federationMessages.inc({ type: message.type });
};

const handlePrice = (service: RouterService, message: RouterControlMessage<RouterPriceSheet>): void => {
  service.federation.priceSheets.set(message.payload.jobType, message.payload);
  federationMessages.inc({ type: message.type });
};

const handleStatus = (service: RouterService, message: RouterControlMessage<RouterStatusPayload>): void => {
  service.federation.status = message.payload;
  federationMessages.inc({ type: message.type });
};

const handleBid = (service: RouterService, message: RouterControlMessage<RouterBidPayload>): void => {
  service.federation.bids.set(message.payload.jobId, message.payload);
  federationMessages.inc({ type: message.type });
};

const handleAward = (service: RouterService, message: RouterControlMessage<RouterAwardPayload>): void => {
  service.federation.awards.set(message.payload.jobId, message);
  federationMessages.inc({ type: message.type });
};

const handleRfb = async (
  service: RouterService,
  config: RouterConfig,
  runtime: FederationNostrRuntime,
  message: RouterControlMessage<RouterRfbPayload>,
): Promise<void> => {
  const eligibility = canBidForRfb(service, config, message.payload);
  if (!eligibility.ok) {
    return;
  }
  const candidatePrice = estimateBidPrice(eligibility.priceSheet, message.payload.sizeEstimate);
  if (candidatePrice > message.payload.maxPriceMsat) {
    return;
  }
  if (!config.privateKey) {
    return;
  }
  const bid: RouterControlMessage<RouterBidPayload> = {
    type: 'BID',
    version: '0.1',
    routerId: config.keyId,
    messageId: `${config.keyId}:${message.payload.jobId}:${Date.now()}`,
    timestamp: Date.now(),
    expiry: message.expiry,
    payload: {
      jobId: message.payload.jobId,
      priceMsat: candidatePrice,
      etaMs: 120,
      capacityToken: `${config.keyId}:${message.payload.jobId}`,
      bidHash: message.payload.jobHash,
    },
    sig: '',
  };
  const event = buildRouterControlEvent(bid, config.privateKey);
  await publishEvent(runtime.pool, runtime.relays, event);
};

const shouldIgnore = (
  config: RouterConfig,
  message: RouterControlMessage<unknown>,
  peerScore?: number,
): boolean => {
  if (message.routerId === config.keyId) {
    return true;
  }
  if (config.federation?.nostrBlockPeers?.includes(message.routerId)) {
    return true;
  }
  if (config.federation?.nostrMutePeers?.includes(message.routerId)) {
    return true;
  }
  if (config.federation?.nostrAllowedPeers?.length) {
    if (!config.federation.nostrAllowedPeers.includes(message.routerId)) {
      return true;
    }
  }
  if (config.federation?.nostrWotEnabled) {
    const minScore = config.federation.nostrWotMinScore ?? 0;
    if ((peerScore ?? 0) < minScore) {
      return true;
    }
  }
  if (message.expiry < Date.now()) {
    return true;
  }
  return false;
};

const withinContentLimit = (config: RouterConfig, event: NostrEvent): boolean => {
  const limit = config.federation?.nostrMaxContentBytes;
  if (!limit) {
    return true;
  }
  return Buffer.byteLength(event.content ?? '', 'utf8') <= limit;
};

const computePeerScore = (
  runtime: FederationNostrRuntime,
  config: RouterConfig,
  routerId: string,
  eventId: string,
): number => {
  const trusted = config.federation?.nostrWotTrustedPeers ?? [];
  const follow = config.federation?.nostrFollowPeers ?? [];
  const base = trusted.includes(routerId) ? 5 : follow.includes(routerId) ? 3 : 0;
  const seenOn = runtime.pool.seenOn.get(eventId);
  const relayBonus = seenOn ? Math.min(5, seenOn.size) : 0;
  const score = base + relayBonus;
  runtime.peerScores.set(routerId, score);
  return score;
};

const buildSubscriptionFilter = (config: RouterConfig): Filter => {
  const kinds = Object.values(ROUTER_NOSTR_KINDS);
  const allowedAuthors = config.federation?.nostrAllowedPeers?.length
    ? config.federation.nostrAllowedPeers
    : config.federation?.nostrFollowPeers?.length
      ? config.federation.nostrFollowPeers
      : undefined;
  const sinceSeconds = config.federation?.nostrSubscribeSinceSeconds ?? 300;
  const since = Math.floor(Date.now() / 1000) - Math.max(0, sinceSeconds);
  return { kinds, since, authors: allowedAuthors };
};

const validatePayload = <T>(
  message: RouterControlMessage<T>,
  validator: (value: unknown) => { ok: true } | { ok: false; errors: string[] },
): boolean => {
  const result = validator(message.payload);
  if (!result.ok) {
    return false;
  }
  if (message.payload && typeof message.payload === 'object' && 'routerId' in message.payload) {
    const routerId = (message.payload as { routerId?: string }).routerId;
    if (typeof routerId === 'string') {
      return routerId === message.routerId;
    }
  }
  return true;
};

export const startFederationNostr = (
  service: RouterService,
  config: RouterConfig,
  relays: string[],
  rateLimiter?: FederationRateLimiter,
): FederationNostrRuntime => {
  const pool = new SimplePool({ enableReconnect: true });
  const relayManager = createFederationRelayManager(
    relays,
    config.federation?.nostrRelayRetryMinMs ?? 1000,
    config.federation?.nostrRelayRetryMaxMs ?? 30_000,
  );
  let subscriptionClose: { close: () => void } | null = null;
  let retryTimer: NodeJS.Timeout | null = null;
  const runtime: FederationNostrRuntime = {
    pool,
    relays,
    peerScores: new Map(),
    relayManager,
    close: () => undefined,
  };
  const filter = buildSubscriptionFilter(config);
  const scheduleRetry = (): void => {
    if (retryTimer) {
      return;
    }
    const delay = relayManager.nextRetryDelayMs();
    retryTimer = setTimeout(() => {
      retryTimer = null;
      subscribeToRelays();
    }, delay ?? 1000);
  };

  const subscribeToRelays = (): void => {
    if (subscriptionClose) {
      subscriptionClose.close();
      subscriptionClose = null;
    }
    const activeRelays = relayManager.getActiveRelays();
    if (activeRelays.length === 0) {
      scheduleRetry();
      return;
    }
    runtime.relays = activeRelays;
    subscriptionClose = pool.subscribe(activeRelays, filter, {
      onevent: async (event) => {
        if (!withinContentLimit(config, event)) {
          return;
        }
        const parsed = parseRouterControlEvent(event);
        if (!parsed.ok) {
          federationRelayFailures.inc({ stage: 'parse' });
          return;
        }
        const message = parsed.message;
        const peerScore = computePeerScore(runtime, config, message.routerId, event.id);
        if (shouldIgnore(config, message, peerScore)) {
          return;
        }
        switch (message.type) {
          case 'CAPS_ANNOUNCE': {
            if (!validatePayload(message, validateRouterCapabilityProfile)) {
              federationRelayFailures.inc({ stage: 'validation' });
              return;
            }
            handleCaps(service, message);
            break;
          }
          case 'PRICE_ANNOUNCE': {
            if (!validatePayload(message, validateRouterPriceSheet)) {
              federationRelayFailures.inc({ stage: 'validation' });
              return;
            }
            handlePrice(service, message);
            break;
          }
          case 'STATUS_ANNOUNCE': {
            if (!validatePayload(message, validateRouterStatusPayload)) {
              federationRelayFailures.inc({ stage: 'validation' });
              return;
            }
            handleStatus(service, message);
            break;
          }
          case 'RFB': {
            if (!validatePayload(message, validateRouterRfbPayload)) {
              federationRelayFailures.inc({ stage: 'validation' });
              return;
            }
            if (rateLimiter && !rateLimiter.allow(message.routerId, message.type)) {
              return;
            }
            await handleRfb(service, config, runtime, message);
            break;
          }
          case 'BID': {
            if (!validatePayload(message, validateRouterBidPayload)) {
              federationRelayFailures.inc({ stage: 'validation' });
              return;
            }
            if (rateLimiter && !rateLimiter.allow(message.routerId, message.type)) {
              return;
            }
            handleBid(service, message);
            break;
          }
          case 'AWARD': {
            if (!validatePayload(message, validateRouterAwardPayload)) {
              federationRelayFailures.inc({ stage: 'validation' });
              return;
            }
            if (rateLimiter && !rateLimiter.allow(message.routerId, message.type)) {
              return;
            }
            if ((message.payload as RouterAwardPayload).winnerRouterId !== config.keyId) {
              return;
            }
            handleAward(service, message);
            break;
          }
          default:
            break;
        }
      },
      onclose: (reason) => {
        federationRelayFailures.inc({ stage: 'subscribe' });
        for (const relay of activeRelays) {
          relayManager.recordFailure(relay);
        }
        logWarn('[router] nostr federation subscription closed', { reason });
        scheduleRetry();
      },
    });
  };

  subscribeToRelays();
  runtime.close = () => {
    if (subscriptionClose) {
      subscriptionClose.close();
      subscriptionClose = null;
    }
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    pool.close(relays);
    pool.destroy();
  };
  logInfo('[router] nostr federation subscription active', { relays: relays.length });
  return runtime;
};

export const publishFederationToRelays = async (
  service: RouterService,
  config: RouterConfig,
  runtime: FederationNostrRuntime,
): Promise<void> => {
  if (!config.federation?.nostrEnabled || !config.privateKey) {
    return;
  }
  await publishLocalMessages(service, config, runtime);
};
