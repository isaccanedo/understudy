FROM node:22-bookworm-slim

RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/computer/package.json apps/computer/package.json
COPY apps/host/package.json apps/host/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/characters/package.json packages/characters/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/runtime/package.json packages/runtime/package.json
RUN pnpm install --frozen-lockfile --prod --filter @understudy/host... \
 && pnpm store prune \
 && rm -rf /root/.cache /root/.local/share/pnpm
COPY packages/protocol/src packages/protocol/src
COPY packages/runtime/src packages/runtime/src
COPY apps/host/src apps/host/src

ARG UNDERSTUDY_VERSION=dev
ENV UNDERSTUDY_VERSION=${UNDERSTUDY_VERSION}

CMD ["node", "--experimental-strip-types", "--no-warnings", "/app/apps/host/src/main.ts"]
