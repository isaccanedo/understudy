FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @understudy/web... --filter @understudy/extension...
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @understudy/extension build && pnpm --filter @understudy/web build

FROM node:22-alpine AS run
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME_BIND=0.0.0.0 \
    UNDERSTUDY_EXTENSION_DIR=/app/apps/extension/dist
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
COPY --from=build --chown=node:node /repo/apps/web/dist ./apps/web/dist
COPY --from=build --chown=node:node /repo/apps/web/drizzle ./apps/web/drizzle
COPY --from=build --chown=node:node /repo/apps/extension/dist ./apps/extension/dist
WORKDIR /app/apps/web
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "dist/server.mjs"]
