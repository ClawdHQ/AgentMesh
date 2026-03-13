FROM node:20-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm@9
COPY package.json pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/agent-sdk/package.json ./packages/agent-sdk/
COPY apps/specialist-agents/package.json ./apps/specialist-agents/
RUN pnpm install --frozen-lockfile
COPY packages/shared ./packages/shared
COPY packages/agent-sdk ./packages/agent-sdk
COPY apps/specialist-agents ./apps/specialist-agents
RUN pnpm --filter @agentmesh/shared build
RUN pnpm --filter @agentmesh/agent-sdk build
RUN pnpm --filter @agentmesh/specialist-agents build

FROM node:20-alpine
WORKDIR /app
RUN npm install -g pnpm@9
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/agent-sdk/dist ./packages/agent-sdk/dist
COPY --from=builder /app/packages/agent-sdk/package.json ./packages/agent-sdk/
COPY --from=builder /app/apps/specialist-agents/dist ./apps/specialist-agents/dist
COPY --from=builder /app/apps/specialist-agents/package.json ./apps/specialist-agents/
RUN pnpm install --prod --frozen-lockfile
EXPOSE 3003
CMD ["node", "apps/specialist-agents/dist/index.js"]
