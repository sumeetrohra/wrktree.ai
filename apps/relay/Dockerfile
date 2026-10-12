# Self-host relay: the Node build (Hono + ws + SQLite). Build from the repo root:
#   docker build -f apps/relay/Dockerfile -t agentdeck-relay .
FROM node:22-bookworm-slim AS build
ENV HUSKY=0
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm --filter "@agentdeck/relay..." build \
  && pnpm --filter @agentdeck/relay deploy --prod --legacy /out

FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 RELAY_DATA_DIR=/data
WORKDIR /app
COPY --from=build /out /app
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
CMD ["node", "dist/main.node.js"]
