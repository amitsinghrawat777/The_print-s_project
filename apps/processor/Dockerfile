# Build from the repo root:  docker build -f apps/processor/Dockerfile -t print-processor .
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/processor apps/processor
RUN pnpm install --frozen-lockfile --filter @print/processor...
RUN pnpm --filter @print/shared build && pnpm --filter @print/processor build
RUN pnpm deploy --legacy --filter @print/processor --prod /out

FROM node:22-slim
# Ghostscript makes greyscale copies of B&W pages for single-pass mixed-colour jobs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ghostscript \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out .
ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
