import { parsePrivateKey } from '@fed-ai/protocol';
import { createRouterService } from './server';
import { defaultRouterConfig, RouterConfig } from './config';
import { createRouterHttpServer } from './http';

const getEnv = (key: string): string | undefined => {
  return process.env[key];
};

const buildConfig = (): RouterConfig => {
  const privateKey = getEnv('ROUTER_PRIVATE_KEY_PEM');

  return {
    ...defaultRouterConfig,
    routerId: getEnv('ROUTER_ID') ?? defaultRouterConfig.routerId,
    keyId: getEnv('ROUTER_KEY_ID') ?? defaultRouterConfig.keyId,
    endpoint: getEnv('ROUTER_ENDPOINT') ?? defaultRouterConfig.endpoint,
    port: Number(getEnv('ROUTER_PORT') ?? defaultRouterConfig.port),
    privateKey: privateKey ? parsePrivateKey(privateKey) : undefined,
    requirePayment: (getEnv('ROUTER_REQUIRE_PAYMENT') ?? 'false').toLowerCase() === 'true',
  };
};

const start = (): void => {
  const config = buildConfig();
  const service = createRouterService(config);
  const server = createRouterHttpServer(service, config);

  server.listen(config.port);
};

start();
