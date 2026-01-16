export type RouterConfig = {
  routerId: string;
  endpoint: string;
};

export const defaultRouterConfig: RouterConfig = {
  routerId: 'router-1',
  endpoint: 'http://localhost:8080',
};
