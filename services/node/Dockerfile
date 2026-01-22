FROM node:20-bookworm-slim

WORKDIR /app

RUN npm install -g pnpm@9.0.0

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY services/node ./services/node
COPY services/router ./services/router
COPY tools ./tools

RUN pnpm install
RUN pnpm --filter @fed-ai/protocol build

CMD ["pnpm", "--filter", "@fed-ai/node", "dev"]
