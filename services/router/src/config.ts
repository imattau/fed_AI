export type RouterConfig = {
  routerId: string;
  keyId: string;
  endpoint: string;
  port: number;
  privateKey?: import('node:crypto').KeyObject;
};

export const defaultRouterConfig: RouterConfig = {
  routerId: 'router-1',
  keyId: 'router-key-1',
  endpoint: 'http://localhost:8080',
  port: 8080,
};
