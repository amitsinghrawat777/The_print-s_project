# Build from the repo root: docker build -f apps/processor/Dockerfile .
FROM node:22-slim AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/processor/package.json apps/processor/
RUN npm ci --workspace @prints/processor --include-workspace-root=false
COPY packages/shared packages/shared
COPY apps/processor apps/processor
RUN npm run build -w @prints/processor

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/processor/package.json ./
RUN npm install --omit=dev --no-package-lock --ignore-scripts \
  $(node -e "const d=require('./package.json').dependencies;console.log(Object.entries(d).filter(([n])=>!n.startsWith('@prints/')).map(([n,v])=>n+'@'+v).join(' '))")
COPY --from=build /repo/apps/processor/dist ./dist
USER node
EXPOSE 4000
CMD ["node", "--enable-source-maps", "dist/index.js"]
