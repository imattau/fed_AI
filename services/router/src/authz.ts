import type { RouterConfig } from './config';

type AccessResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

const block = (error: string, status = 403): AccessResult => ({ ok: false, status, error });

export const checkClientAccess = (config: RouterConfig, keyId: string): AccessResult => {
  if (config.clientBlockList?.includes(keyId)) {
    return block('client-blocked');
  }
  if (config.clientMuteList?.includes(keyId)) {
    return block('client-muted');
  }
  if (config.clientAllowList?.length && !config.clientAllowList.includes(keyId)) {
    return block('client-not-allowed', 401);
  }
  return { ok: true };
};
