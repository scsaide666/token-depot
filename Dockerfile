# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24.22.0-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Build uses placeholders only; production secrets enter at runtime.
RUN APP_ORIGIN=https://build.invalid DATABASE_URL=postgresql://build:build@127.0.0.1/build SEO_INDEXING_ENABLED=false npm run build

# Full build dependencies are available only in the opt-in local test image.
FROM builder AS test-tools
ENV NODE_ENV=production
USER node
ENTRYPOINT ["node", "--env-file=/run/secrets/app_env"]
CMD ["node_modules/prisma/build/index.js", "migrate", "deploy"]

# Migration and reservation recovery need Prisma CLI and tsx, not ESLint,
# TypeScript, the SDK fixtures or the rest of the development toolchain.
# This manifest change is image-local; the repository lockfile stays intact.
FROM builder AS ops-dependencies
RUN node -e 'const fs = require("node:fs"); const p = require("./package.json"); for (const name of ["prisma", "tsx"]) p.dependencies[name] = p.devDependencies[name]; delete p.devDependencies; fs.writeFileSync("package.json", JSON.stringify(p));' \
 && npm prune --omit=dev --ignore-scripts --no-audit --no-fund \
 && test ! -d node_modules/eslint && test ! -d node_modules/braces

FROM ${NODE_IMAGE} AS runtime-base
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# Apply available updates in the same Debian release. npm is unnecessary in
# shipped containers; unpatched CVEs are reported rather than suppressed.
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && rm -rf /var/lib/apt/lists/* /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
 && test ! -e /usr/local/lib/node_modules/npm && node --version
USER node

FROM runtime-base AS tools
# Prisma's operator CLI needs OpenSSL discovery; the application runner does not.
USER root
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
USER node
COPY --from=ops-dependencies --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=ops-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/generated ./generated
COPY --from=builder --chown=node:node /app/lib ./lib
COPY --from=builder --chown=node:node /app/scripts/recover-reservations.ts /app/scripts/recovery-batch.ts ./scripts/
COPY --from=builder --chown=node:node /app/deploy/restrict-mainland.ts ./deploy/restrict-mainland.ts
COPY --from=builder --chown=node:node /app/prisma.config.ts /app/tsconfig.json ./
ENTRYPOINT ["node", "--env-file=/run/secrets/app_env"]
CMD ["node_modules/prisma/build/index.js", "migrate", "deploy"]

FROM runtime-base AS runner
ENV HOSTNAME=0.0.0.0 PORT=3000
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
EXPOSE 3000
CMD ["node", "--env-file=/run/secrets/app_env", "server.js"]
