import type { NodeConfig } from '../config';

export type SandboxCheck = { ok: true } | { ok: false; error: string };

export const enforceSandboxPolicy = (config: NodeConfig): SandboxCheck => {
  if (config.sandboxMode !== 'restricted') {
    return { ok: true };
  }

  if (!config.sandboxAllowedRunners || config.sandboxAllowedRunners.length === 0) {
    return { ok: false, error: 'sandbox-allowlist-empty' };
  }

  if (!config.sandboxAllowedRunners.includes(config.runnerName)) {
    return { ok: false, error: 'sandbox-runner-not-allowed' };
  }

  return { ok: true };
};
