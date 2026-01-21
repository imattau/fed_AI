import type { RouterConfig } from '../config';
import type { PaymentSplit } from '@fed-ai/protocol';

export const computeRouterFeeSats = (amountSats: number, config: RouterConfig): number => {
  if (!config.routerFeeEnabled || !config.routerFeeSplitEnabled) {
    return 0;
  }
  const bps = Math.max(0, config.routerFeeBps ?? 0);
  const flat = Math.max(0, config.routerFeeFlatSats ?? 0);
  let fee = Math.round((amountSats * bps) / 10_000 + flat);
  if (config.routerFeeMinSats !== undefined) {
    fee = Math.max(config.routerFeeMinSats, fee);
  }
  if (config.routerFeeMaxSats !== undefined) {
    fee = Math.min(config.routerFeeMaxSats, fee);
  }
  return Math.max(0, fee);
};

export const normalizeSplits = (splits?: PaymentSplit[]): PaymentSplit[] => {
  return (splits ?? []).slice().sort((a, b) => {
    const keyA = `${a.payeeType}:${a.payeeId}:${a.amountSats}:${a.role ?? ''}`;
    const keyB = `${b.payeeType}:${b.payeeId}:${b.amountSats}:${b.role ?? ''}`;
    return keyA.localeCompare(keyB);
  });
};

export const splitsMatch = (expected?: PaymentSplit[], actual?: PaymentSplit[]): boolean => {
  if (!expected || expected.length === 0) {
    return !actual || actual.length === 0;
  }
  if (!actual || actual.length !== expected.length) {
    return false;
  }
  const sortedExpected = normalizeSplits(expected);
  const sortedActual = normalizeSplits(actual);
  return sortedExpected.every((split, index) => {
    const candidate = sortedActual[index];
    return (
      split.payeeType === candidate.payeeType &&
      split.payeeId === candidate.payeeId &&
      split.amountSats === candidate.amountSats &&
      split.role === candidate.role
    );
  });
};
