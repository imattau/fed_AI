import { generateKeyPairSync } from 'node:crypto';
import { exportPrivateKeyHex, exportPublicKeyHex } from '@fed-ai/protocol';

export const usage = (): string => {
  return `fed-ai <command>

Commands:
  gen-keys
  profile --latency-targets host1,host2
  bench --mode node|router --latency-targets host1,host2
  recommend --profile profile.json --bench bench.json
  manifest --role node|router --id <id> --key-id <pub> --private-key <hex|pem> --profile profile.json --bench bench.json --write out.json
  quote --router <url> --key-id <pub> --private-key <hex|pem> --model <id> --input <n> --output <n> --max-tokens <n>
  infer --router <url> --key-id <pub> --private-key <hex|pem> --model <id> --prompt <text> --max-tokens <n>
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

export const generateKeyPairHex = (): { publicKey: string; privateKey: string } => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: exportPublicKeyHex(publicKey),
    privateKey: exportPrivateKeyHex(privateKey),
  };
};
