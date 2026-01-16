export type NodeConfig = {
  nodeId: string;
  keyId: string;
  endpoint: string;
  routerEndpoint: string;
  heartbeatIntervalMs: number;
  runnerName: string;
  port: number;
  capacityMaxConcurrent: number;
  capacityCurrentLoad: number;
  privateKey?: import('node:crypto').KeyObject;
  routerPublicKey?: import('node:crypto').KeyObject;
};

export const defaultNodeConfig: NodeConfig = {
  nodeId: 'node-1',
  keyId: 'node-key-1',
  endpoint: 'http://localhost:8081',
  routerEndpoint: 'http://localhost:8080',
  heartbeatIntervalMs: 10_000,
  runnerName: 'mock',
  port: 8081,
  capacityMaxConcurrent: 4,
  capacityCurrentLoad: 0,
};
