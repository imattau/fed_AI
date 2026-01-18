import type { NodeConfig } from './config';

type AccessResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

const block = (error: string, status = 403): AccessResult => ({ ok: false, status, error });

export const checkRouterAccess = (config: NodeConfig, keyId: string): AccessResult => {
  if (config.routerBlockList?.includes(keyId)) {
    return block('router-blocked');
  }
  if (config.routerMuteList?.includes(keyId)) {
    return block('router-muted');
  }
  const allowedRouters = [
    ...(config.routerAllowList ?? []),
    ...(config.routerKeyId ? [config.routerKeyId] : []),
  ];
  if (allowedRouters.length > 0 && !allowedRouters.includes(keyId)) {
    return block('router-not-allowed', 401);
  }
  if (config.routerFollowList?.length && !config.routerFollowList.includes(keyId)) {
    return block('router-not-followed');
  }
  return { ok: true };
};
