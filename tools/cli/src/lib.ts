import { generateSecretKey, getPublicKey } from 'nostr-tools';
import {
  exportPrivateKeyHex,
  exportPrivateKeyNsec,
  exportPublicKeyHex,
  exportPublicKeyNpub,
} from '@fed-ai/protocol';

export const usage = (): string => {
  return `fed-ai <command>

Commands:
  gen-keys
  setup --role router|node|both [--router-out <file>] [--node-out <file>]
  profile --latency-targets host1,host2
  bench --mode node|router --latency-targets host1,host2
  recommend --profile profile.json --bench bench.json
  manifest --role node|router --id <id> --key-id <npub> --private-key <nsec|hex> --profile profile.json --bench bench.json --write out.json
    [--skip-relays] [--bootstrap <url,...>] [--aggregators <url,...>] [--trust-scores <url=score,...>] [--min-score <n>] [--max-results <n>]
  quote --router <url> --key-id <npub> --private-key <nsec|hex> --model <id> --input <n> --output <n> --max-tokens <n> [--out quote.json]
  infer --router <url> --key-id <npub> --private-key <nsec|hex> --model <id> --prompt <text> --max-tokens <n>
    [--receipts receipt1.json,receipt2.json] [--payment-request-out invoice.json] [--out response.json]
  receipt --payment-request <file> --key-id <npub> --private-key <nsec|hex> [--amount <sats>] [--router <url>] [--write receipt.json]
  relays [--aggregators <url,...>] [--bootstrap <url,...>] [--trust-scores <url=score,...>] [--min-score <n>] [--max-results <n>]
`;
};

export const parseArgs = (args: string[]): Record<string, string> => {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) {
      result[key] = 'true';
    } else {
      result[key] = value;
      i += 1;
    }
  }
  return result;
};

export const generateKeyPairHex = (): {
  publicKey: string;
  privateKey: string;
  npub: string;
  nsec: string;
} => {
  const privateKey = generateSecretKey();
  const publicKey = getPublicKey(privateKey);
  const publicKeyBytes = Buffer.from(publicKey, 'hex');
  return {
    publicKey: exportPublicKeyHex(publicKeyBytes),
    privateKey: exportPrivateKeyHex(privateKey),
    npub: exportPublicKeyNpub(publicKeyBytes),
    nsec: exportPrivateKeyNsec(privateKey),
  };
};
