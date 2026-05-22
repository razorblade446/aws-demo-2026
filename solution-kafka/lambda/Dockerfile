FROM public.ecr.aws/lambda/nodejs:22

RUN corepack enable && corepack prepare pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY dist/ ./

CMD ["index.handler"]
