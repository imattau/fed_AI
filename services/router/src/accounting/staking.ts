import type { Envelope, StakeCommit, StakeSlash } from '@fed-ai/protocol';

export type StakeRecord = {
  commit: StakeCommit;
  envelope: Envelope<StakeCommit>;
};

export type StakeStore = {
  commits: Map<string, StakeRecord>;
  slashes: Map<string, StakeSlash>;
};

export const createStakeStore = (): StakeStore => ({
  commits: new Map(),
  slashes: new Map(),
});

export const recordCommit = (store: StakeStore, envelope: Envelope<StakeCommit>): void => {
  store.commits.set(envelope.payload.stakeId, { commit: envelope.payload, envelope });
};

export const recordSlash = (store: StakeStore, slash: StakeSlash): void => {
  store.slashes.set(slash.slashId, slash);
};

export const effectiveStakeUnits = (store: StakeStore, actorId: string, nowMs = Date.now()): number => {
  let units = 0;
  for (const record of store.commits.values()) {
    if (record.commit.actorId !== actorId) {
      continue;
    }
    if (record.commit.expiresAtMs <= nowMs) {
      continue;
    }
    units += record.commit.units;
  }

  for (const slash of store.slashes.values()) {
    if (slash.actorId !== actorId) {
      continue;
    }
    units -= slash.units;
  }

  return Math.max(0, units);
};
