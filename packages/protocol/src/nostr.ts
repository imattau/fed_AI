import { finalizeEvent, getPublicKey, nip19, verifyEvent } from 'nostr-tools';
import type { Event as NostrEvent } from 'nostr-tools';
import type { RouterControlMessage } from './types';
import { decodeNsecToHex, isNostrNpub, isNostrNsec } from './keys';

export const ROUTER_NOSTR_KINDS = {
  CAPS_ANNOUNCE: 30020,
  PRICE_ANNOUNCE: 30021,
  STATUS_ANNOUNCE: 30022,
  RECEIPT_SUMMARY: 30023,
  RFB: 20020,
  BID: 20021,
  AWARD: 20022,
  CANCEL: 20023,
} as const;

export type RouterNostrKind = (typeof ROUTER_NOSTR_KINDS)[keyof typeof ROUTER_NOSTR_KINDS];

const KIND_TO_TYPE: Record<RouterNostrKind, RouterControlMessage<unknown>['type']> = {
  [ROUTER_NOSTR_KINDS.CAPS_ANNOUNCE]: 'CAPS_ANNOUNCE',
  [ROUTER_NOSTR_KINDS.PRICE_ANNOUNCE]: 'PRICE_ANNOUNCE',
  [ROUTER_NOSTR_KINDS.STATUS_ANNOUNCE]: 'STATUS_ANNOUNCE',
  [ROUTER_NOSTR_KINDS.RECEIPT_SUMMARY]: 'RECEIPT_SUMMARY',
  [ROUTER_NOSTR_KINDS.RFB]: 'RFB',
  [ROUTER_NOSTR_KINDS.BID]: 'BID',
  [ROUTER_NOSTR_KINDS.AWARD]: 'AWARD',
  [ROUTER_NOSTR_KINDS.CANCEL]: 'CANCEL',
};

const TYPE_TO_KIND: Record<RouterControlMessage<unknown>['type'], RouterNostrKind> = {
  CAPS_ANNOUNCE: ROUTER_NOSTR_KINDS.CAPS_ANNOUNCE,
  PRICE_ANNOUNCE: ROUTER_NOSTR_KINDS.PRICE_ANNOUNCE,
  STATUS_ANNOUNCE: ROUTER_NOSTR_KINDS.STATUS_ANNOUNCE,
  RECEIPT_SUMMARY: ROUTER_NOSTR_KINDS.RECEIPT_SUMMARY,
  RFB: ROUTER_NOSTR_KINDS.RFB,
  BID: ROUTER_NOSTR_KINDS.BID,
  AWARD: ROUTER_NOSTR_KINDS.AWARD,
  CANCEL: ROUTER_NOSTR_KINDS.CANCEL,
};

const readTag = (event: NostrEvent, key: string): string | undefined => {
  const tag = event.tags.find((entry) => entry[0] === key);
  return tag?.[1];
};

const buildTags = (message: RouterControlMessage<unknown>): string[][] => {
  return [
    ['t', message.type],
    ['v', message.version],
    ['msg', message.messageId],
    ['exp', message.expiry.toString()],
  ];
};

const toSecretKeyBytes = (privateKey: Uint8Array | string): Uint8Array => {
  if (privateKey instanceof Uint8Array) {
    return privateKey;
  }
  if (isNostrNsec(privateKey)) {
    return Buffer.from(decodeNsecToHex(privateKey), 'hex');
  }
  return Buffer.from(privateKey, 'hex');
};

export const buildRouterControlEvent = <T>(
  message: RouterControlMessage<T>,
  privateKey: Uint8Array | string,
): NostrEvent => {
  if (!isNostrNpub(message.routerId)) {
    throw new Error('routerId must be a Nostr npub');
  }
  const secret = toSecretKeyBytes(privateKey);
  const pubkeyHex = getPublicKey(secret);
  const expectedNpub = nip19.npubEncode(pubkeyHex);
  if (expectedNpub !== message.routerId) {
    throw new Error('routerId does not match provided private key');
  }

  const kind = TYPE_TO_KIND[message.type];
  const content = JSON.stringify(message.payload);
  const createdAt = Math.floor(message.timestamp / 1000);
  return finalizeEvent(
    {
      kind,
      created_at: createdAt,
      tags: buildTags(message),
      content,
    },
    secret,
  );
};

export const parseRouterControlEvent = <T>(
  event: NostrEvent,
): { ok: true; message: RouterControlMessage<T> } | { ok: false; error: string } => {
  if (!verifyEvent(event)) {
    return { ok: false, error: 'invalid-signature' };
  }
  const typeTag = readTag(event, 't');
  const resolvedType = typeTag ?? KIND_TO_TYPE[event.kind as RouterNostrKind];
  if (!resolvedType || !(resolvedType in TYPE_TO_KIND)) {
    return { ok: false, error: 'unsupported-kind' };
  }
  const type = resolvedType as RouterControlMessage<unknown>['type'];
  const routerId = nip19.npubEncode(event.pubkey);
  const messageId = readTag(event, 'msg') ?? event.id;
  const version = readTag(event, 'v') ?? '0.1';
  const expiry = Number(readTag(event, 'exp'));
  if (!Number.isFinite(expiry)) {
    return { ok: false, error: 'missing-expiry' };
  }
  let payload: T;
  try {
    payload = JSON.parse(event.content) as T;
  } catch {
    return { ok: false, error: 'invalid-payload' };
  }
  return {
    ok: true,
    message: {
      type,
      version,
      routerId,
      messageId,
      timestamp: event.created_at * 1000,
      expiry,
      payload,
      sig: event.sig,
    },
  };
};
