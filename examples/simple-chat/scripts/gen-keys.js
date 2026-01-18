const fs = require('node:fs');
const { generateSecretKey, getPublicKey, nip19 } = require('nostr-tools');

const [,, outputPath = '/keys/keys.env'] = process.argv;

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
const nodeCpuKey = buildKeys();

const lines = [
  `ROUTER_KEY_ID=${router.npub}`,
  `ROUTER_PRIVATE_KEY_PEM=${router.nsec}`,
  `ROUTER_PUBLIC_KEY_PEM=${router.npub}`,
  `NODE_KEY_ID=${nodeKey.npub}`,
  `NODE_PRIVATE_KEY_PEM=${nodeKey.nsec}`,
  `NODE2_KEY_ID=${nodeCpuKey.npub}`,
  `NODE2_PRIVATE_KEY_PEM=${nodeCpuKey.nsec}`,
];

fs.mkdirSync(require('node:path').dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
console.log(`wrote keys to ${outputPath}`);
