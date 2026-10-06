FROM node:22-bookworm-slim AS workspace

ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"
RUN corepack enable && corepack prepare pnpm@12.8.1 --activate

WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

COPY . .

FROM workspace AS api
RUN apt-get update \
	&& apt-get install -y --no-install-recommends openssl ffmpeg \
	&& rm -rf /var/lib/apt/lists/*
RUN pnpm --filter @app/api exec prisma generate --schema prisma/schema.prisma
RUN pnpm --filter @app/api build
WORKDIR /workspace/apps/api
EXPOSE 4000
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node --import=tsx dist/server.js"]

FROM workspace AS web-build
ARG VITE_API_BASE=https://api.intouchsocial.com
ENV VITE_API_BASE=${VITE_API_BASE}
RUN pnpm --filter @app/web build

FROM nginx:1.29-alpine AS web
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /workspace/apps/web/dist/ /usr/share/nginx/html/
EXPOSE 80