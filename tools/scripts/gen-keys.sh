#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

node - <<'NODE' > "$ENV_FILE"
const { generateKeyPairSync } = require('node:crypto');

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

const stripPrefix = (keyDer, prefix, label) => {
  if (!keyDer.subarray(0, prefix.length).equals(prefix)) {
    throw new Error(`${label} key does not match expected Ed25519 DER prefix`);
  }
  return keyDer.subarray(prefix.length).toString('hex');
};

const exportPublicKeyHex = (key) => {
  const spki = key.export({ format: 'der', type: 'spki' });
  return stripPrefix(spki, ED25519_SPKI_PREFIX, 'public');
};

const exportPrivateKeyHex = (key) => {
  const pkcs8 = key.export({ format: 'der', type: 'pkcs8' });
  return stripPrefix(pkcs8, ED25519_PKCS8_PREFIX, 'private');
};

const router = generateKeyPairSync('ed25519');
const nodeKey = generateKeyPairSync('ed25519');

const routerPublic = exportPublicKeyHex(router.publicKey);
const routerPrivate = exportPrivateKeyHex(router.privateKey);
const nodePublic = exportPublicKeyHex(nodeKey.publicKey);
const nodePrivate = exportPrivateKeyHex(nodeKey.privateKey);

process.stdout.write(`ROUTER_KEY_ID=${routerPublic}\n`);
process.stdout.write(`ROUTER_PRIVATE_KEY_PEM=${routerPrivate}\n`);
process.stdout.write(`ROUTER_PUBLIC_KEY_PEM=${routerPublic}\n`);
process.stdout.write(`NODE_KEY_ID=${nodePublic}\n`);
process.stdout.write(`NODE_PRIVATE_KEY_PEM=${nodePrivate}\n`);
NODE

echo "Wrote $ENV_FILE"
