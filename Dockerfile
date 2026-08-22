FROM node:22-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY tsconfig.json tsconfig.server.json eslint.config.js .prettierrc.json ./
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts
COPY client ./client
RUN npm run build

FROM base AS production-dependencies
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev \
  && npm run prisma:generate \
  && npm cache clean --force

FROM base AS runtime
ENV NODE_ENV=production APP_ROLE=web PORT=3000
RUN groupadd --system --gid 10001 homix \
  && useradd --system --uid 10001 --gid homix --home-dir /app homix \
  && rm -rf /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx
COPY --from=production-dependencies --chown=homix:homix /app/node_modules ./node_modules
COPY --from=build --chown=homix:homix /app/dist ./dist
COPY --from=build --chown=homix:homix /app/prisma ./prisma
COPY --chown=homix:homix package.json ./
USER homix
EXPOSE 3000
ENTRYPOINT ["node", "dist/server/src/bootstrap.js"]
