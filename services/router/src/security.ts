import { isIP } from 'node:net';

const PRIVATE_IPV4_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^127\./,
  /^169\.254\./,
];

// Simple check for unique local IPv6 (fc00::/7) and link-local (fe80::/10)
// This is not exhaustive but catches common cases.
const PRIVATE_IPV6_RANGES = [
  /^fc/, 
  /^fd/, 
  /^fe80/
];

export const isPrivateIP = (ip: string): boolean => {
  if (isIP(ip) === 4) {
    return PRIVATE_IPV4_RANGES.some((regex) => regex.test(ip));
  }
  if (isIP(ip) === 6) {
    const normalized = ip.toLowerCase();
    return PRIVATE_IPV6_RANGES.some((regex) => regex.test(normalized)) || normalized === '::1';
  }
  return false;
};

export const validateEndpoint = (url: string, allowPrivate = false): { ok: true } | { ok: false; error: string } => {
  if (allowPrivate) {
    return { ok: true };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: 'invalid-url' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'invalid-protocol' };
  }

  const hostname = parsed.hostname;

  if (hostname === 'localhost') {
    return { ok: false, error: 'private-address-blocked' };
  }

  if (isPrivateIP(hostname)) {
    return { ok: false, error: 'private-ip-blocked' };
  }

  // Note: This does not prevent DNS rebinding. 
  // For high security, the DNS resolution should happen once and the IP checked.
  // However, node fetch uses internal DNS. 
  // Blocking obvious private IPs is a strong first layer.

  return { ok: true };
};
