import type {
  RouterJobSubmit,
  RouterPriceSheet,
  RouterRfbPayload,
} from '@fed-ai/protocol';
import type { RouterConfig } from '../config';
import type { RouterService } from '../server';

const privacyRank = {
  PL0: 0,
  PL1: 1,
  PL2: 2,
  PL3: 3,
} as const;

const privacyScore = (level?: RouterJobSubmit['privacyLevel']): number => {
  if (!level) {
    return privacyRank.PL3;
  }
  return privacyRank[level];
};

export const allowsPrivacyLevel = (
  config: RouterConfig,
  level: RouterJobSubmit['privacyLevel'],
): boolean => {
  const max = config.federation?.maxPrivacyLevel;
  return privacyScore(level) <= privacyScore(max);
};

export const estimateBidPrice = (
  price: RouterPriceSheet,
  size: RouterRfbPayload['sizeEstimate'],
): number => {
  const surge = price.currentSurge || 1;
  switch (price.unit) {
    case 'PER_1K_TOKENS': {
      const tokens = size.tokens ?? 0;
      const units = Math.max(1, Math.ceil(tokens / 1000));
      return Math.max(1, Math.round(price.basePriceMsat * surge * units));
    }
    case 'PER_MB': {
      const bytes = size.bytes ?? 0;
      const units = Math.max(1, Math.ceil(bytes / (1024 * 1024)));
      return Math.max(1, Math.round(price.basePriceMsat * surge * units));
    }
    case 'PER_SECOND': {
      const seconds = Math.max(1, Math.ceil((size.tokens ?? 0) / 1000));
      return Math.max(1, Math.round(price.basePriceMsat * surge * seconds));
    }
    case 'PER_JOB':
    default:
      return Math.max(1, Math.round(price.basePriceMsat * surge));
  }
};

export const canBidForRfb = (
  service: RouterService,
  config: RouterConfig,
  payload: RouterRfbPayload,
): { ok: true; priceSheet: RouterPriceSheet } | { ok: false; reason: string } => {
  if (!allowsPrivacyLevel(config, payload.privacyLevel)) {
    return { ok: false, reason: 'privacy-level-not-allowed' };
  }
  const status = service.federation.localStatus;
  if (status?.loadSummary.backpressureState === 'SATURATED') {
    return { ok: false, reason: 'router-saturated' };
  }
  const caps = service.federation.localCapabilities;
  if (caps && !caps.supportedJobTypes.includes(payload.jobType)) {
    return { ok: false, reason: 'job-type-unsupported' };
  }
  const priceSheet = service.federation.localPriceSheets.get(payload.jobType);
  if (!priceSheet) {
    return { ok: false, reason: 'missing-price' };
  }
  return { ok: true, priceSheet };
};
