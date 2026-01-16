import { parsePrivateKey, parsePublicKey } from '@fed-ai/protocol';
import { createNodeService } from './server';
import { defaultNodeConfig, NodeConfig } from './config';
import { MockRunner } from './runners/mock';
import { createNodeHttpServer } from './http';

const getEnv = (key: string): string | undefined => {
  return process.env[key];
};

const buildConfig = (): NodeConfig => {
  const privateKey = getEnv('NODE_PRIVATE_KEY_PEM');
  const routerPublicKey = getEnv('ROUTER_PUBLIC_KEY_PEM');

  return {
    ...defaultNodeConfig,
    nodeId: getEnv('NODE_ID') ?? defaultNodeConfig.nodeId,
    keyId: getEnv('NODE_KEY_ID') ?? defaultNodeConfig.keyId,
    endpoint: getEnv('NODE_ENDPOINT') ?? defaultNodeConfig.endpoint,
    heartbeatIntervalMs: Number(getEnv('NODE_HEARTBEAT_MS') ?? defaultNodeConfig.heartbeatIntervalMs),
    runnerName: getEnv('NODE_RUNNER') ?? defaultNodeConfig.runnerName,
    port: Number(getEnv('NODE_PORT') ?? 8081),
    privateKey: privateKey ? parsePrivateKey(privateKey) : undefined,
    routerPublicKey: routerPublicKey ? parsePublicKey(routerPublicKey) : undefined,
  };
};

const start = (): void => {
  const config = buildConfig();
  const runner = new MockRunner();
  const service = createNodeService(config, runner);
  const server = createNodeHttpServer(service, config);

  server.listen(config.port);
};

start();
