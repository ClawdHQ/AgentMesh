FROM node:20-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm@9
COPY package.json pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/agent-sdk/package.json ./packages/agent-sdk/
COPY apps/orchestrator/package.json ./apps/orchestrator/
RUN pnpm install --frozen-lockfile
COPY packages/shared ./packages/shared
COPY packages/agent-sdk ./packages/agent-sdk
COPY apps/orchestrator ./apps/orchestrator
RUN pnpm --filter @agentmesh/shared build
RUN pnpm --filter @agentmesh/agent-sdk build
RUN pnpm --filter @agentmesh/orchestrator build

FROM node:20-alpine
WORKDIR /app
RUN npm install -g pnpm@9
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/agent-sdk/dist ./packages/agent-sdk/dist
COPY --from=builder /app/packages/agent-sdk/package.json ./packages/agent-sdk/
COPY --from=builder /app/apps/orchestrator/dist ./apps/orchestrator/dist
COPY --from=builder /app/apps/orchestrator/package.json ./apps/orchestrator/
RUN pnpm install --prod --frozen-lockfile
EXPOSE 3002
CMD ["node", "apps/orchestrator/dist/index.js"]
