export type NodeConfig = {
  nodeId: string;
  keyId: string;
  endpoint: string;
  heartbeatIntervalMs: number;
  runnerName: string;
  port: number;
  privateKey?: import('node:crypto').KeyObject;
  routerPublicKey?: import('node:crypto').KeyObject;
};

export const defaultNodeConfig: NodeConfig = {
  nodeId: 'node-1',
  keyId: 'node-key-1',
  endpoint: 'http://localhost:8081',
  heartbeatIntervalMs: 10_000,
  runnerName: 'mock',
  port: 8081,
};
