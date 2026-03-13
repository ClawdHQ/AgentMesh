FROM node:20-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm@9
COPY package.json pnpm-workspace.yaml ./
COPY apps/oversight-dashboard/package.json ./apps/oversight-dashboard/
RUN pnpm install --frozen-lockfile
COPY apps/oversight-dashboard ./apps/oversight-dashboard
RUN pnpm --filter @agentmesh/oversight-dashboard build

FROM nginx:alpine
COPY --from=builder /app/apps/oversight-dashboard/dist /usr/share/nginx/html
COPY apps/oversight-dashboard/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
