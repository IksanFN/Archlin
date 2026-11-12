# One build stage, three runtime images (web, worker, migrate). Built from the cortex/ directory:
#   docker build -f docker/app.Dockerfile --target web .
FROM node:24-slim AS build
RUN npm install -g pnpm@12.18.0
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @archlin/web build && pnpm --filter @archlin/worker build && pnpm --filter @archlin/migrate build

FROM node:24-slim AS web
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.output ./.output
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD ["node","-e","fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node",".output/server/index.mjs"]

# The worker and migrate bundles carry their dependencies, so only dist/ is copied.
FROM node:24-slim AS worker
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/worker/dist ./dist
ENV NODE_ENV=production
USER node
CMD ["node","dist/main.mjs"]

FROM node:24-slim AS migrate
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/migrate/dist ./dist
ENV NODE_ENV=production
USER node
CMD ["node","dist/main.mjs"]
