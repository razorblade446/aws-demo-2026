FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm && CI=true pnpm_config_strict_dep_builds=false pnpm install --frozen-lockfile

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY package.json tsconfig.json ./

CMD ["./node_modules/.bin/tsx", "src/index.ts"]
