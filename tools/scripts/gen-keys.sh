#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

node - <<'NODE' > "$ENV_FILE"
const { generateSecretKey, getPublicKey, nip19 } = require('nostr-tools');

const buildKeys = () => {
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  return {
    npub: nip19.npubEncode(pubkey),
    nsec: nip19.nsecEncode(secret),
  };
};

const router = buildKeys();
const nodeKey = buildKeys();

process.stdout.write(`ROUTER_KEY_ID=${router.npub}\n`);
process.stdout.write(`ROUTER_PRIVATE_KEY_PEM=${router.nsec}\n`);
process.stdout.write(`ROUTER_PUBLIC_KEY_PEM=${router.npub}\n`);
process.stdout.write(`NODE_KEY_ID=${nodeKey.npub}\n`);
process.stdout.write(`NODE_PRIVATE_KEY_PEM=${nodeKey.nsec}\n`);
NODE

echo "Wrote $ENV_FILE"
