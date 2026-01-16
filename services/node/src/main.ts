import { randomUUID } from 'node:crypto';
import { buildEnvelope, parsePrivateKey, parsePublicKey, signEnvelope } from '@fed-ai/protocol';
import type { Capability, NodeDescriptor } from '@fed-ai/protocol';
import { createNodeService } from './server';
import { defaultNodeConfig, NodeConfig } from './config';
import { MockRunner } from './runners/mock';
import { createNodeHttpServer } from './http';
import type { Runner } from './runners/types';

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
    routerEndpoint: getEnv('ROUTER_ENDPOINT') ?? defaultNodeConfig.routerEndpoint,
    heartbeatIntervalMs: Number(getEnv('NODE_HEARTBEAT_MS') ?? defaultNodeConfig.heartbeatIntervalMs),
    runnerName: getEnv('NODE_RUNNER') ?? defaultNodeConfig.runnerName,
    port: Number(getEnv('NODE_PORT') ?? 8081),
    capacityMaxConcurrent: Number(
      getEnv('NODE_CAPACITY_MAX') ?? defaultNodeConfig.capacityMaxConcurrent,
    ),
    capacityCurrentLoad: Number(
      getEnv('NODE_CAPACITY_LOAD') ?? defaultNodeConfig.capacityCurrentLoad,
    ),
    requirePayment: (getEnv('NODE_REQUIRE_PAYMENT') ?? 'false').toLowerCase() === 'true',
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

  if (config.privateKey) {
    void startHeartbeat(service, config).catch((error) => {
      console.warn('heartbeat-start-failed', error instanceof Error ? error.message : String(error));
    });
  } else {
    console.warn('heartbeat-disabled: node private key missing');
  }
};

start();

const buildCapabilities = async (runner: Runner): Promise<Capability[]> => {
  // Pricing is a placeholder until node pricing configuration is wired in.
  const models = await runner.listModels();
  return models.map((model) => ({
    modelId: model.id,
    contextWindow: model.contextWindow,
    maxTokens: model.contextWindow,
    pricing: {
      unit: 'token',
      inputRate: 0,
      outputRate: 0,
      currency: 'USD',
    },
  }));
};

const startHeartbeat = async (service: ReturnType<typeof createNodeService>, config: NodeConfig) => {
  const capabilities = await buildCapabilities(service.runner);

  const sendHeartbeat = async (): Promise<void> => {
    const descriptor: NodeDescriptor = {
      nodeId: config.nodeId,
      keyId: config.keyId,
      endpoint: config.endpoint,
      capacity: {
        maxConcurrent: config.capacityMaxConcurrent,
        currentLoad: config.capacityCurrentLoad,
      },
      capabilities,
    };

    if (!config.privateKey) {
      return;
    }

    const envelope = signEnvelope(
      buildEnvelope(descriptor, randomUUID(), Date.now(), config.keyId),
      config.privateKey,
    );

    try {
      await fetch(`${config.routerEndpoint}/register-node`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(envelope),
      });
    } catch (error) {
      console.warn('heartbeat-send-failed', error instanceof Error ? error.message : String(error));
    }
  };

  await sendHeartbeat();
  setInterval(sendHeartbeat, config.heartbeatIntervalMs);
};
