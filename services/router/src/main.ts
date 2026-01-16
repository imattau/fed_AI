import { createRouterService } from './server';
import { defaultRouterConfig, RouterConfig } from './config';
import { createRouterHttpServer } from './http';

const getEnv = (key: string): string | undefined => {
  return process.env[key];
};

const buildConfig = (): RouterConfig & { port: number } => {
  return {
    ...defaultRouterConfig,
    routerId: getEnv('ROUTER_ID') ?? defaultRouterConfig.routerId,
    endpoint: getEnv('ROUTER_ENDPOINT') ?? defaultRouterConfig.endpoint,
    port: Number(getEnv('ROUTER_PORT') ?? 8080),
  };
};

const start = (): void => {
  const config = buildConfig();
  const service = createRouterService(config);
  const server = createRouterHttpServer(service);

  server.listen(config.port);
};

start();
