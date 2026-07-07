# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/web/package.json packages/web/
RUN npm ci --include=optional
COPY packages/core packages/core
COPY packages/web packages/web
RUN npm -w @event-editor/core run build && npm -w @event-editor/web run build
# core's migrate.js is a CLI entry point that Next's standalone file tracing
# does not pick up (it's never imported by any web route, and drizzle-orm/core
# itself get webpack-bundled into the server chunks rather than kept as real
# node_modules packages). Bundle it standalone with esbuild so the final image
# can run migrations without needing core's source tree or drizzle-orm present
# as a package; only the native better-sqlite3 module stays external (it's
# already traced into the standalone node_modules via serverExternalPackages).
RUN npx esbuild packages/core/dist/migrate.js --bundle --platform=node --format=esm \
      --external:better-sqlite3 --outfile=/tmp/migrate-bundle.mjs

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-impress fonts-dejavu fonts-noto-cjk \
      python3 ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL -o /usr/local/bin/yt-dlp \
      https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp && yt-dlp --version
WORKDIR /app
COPY --from=build /app/packages/web/.next/standalone ./
COPY --from=build /app/packages/web/.next/static ./packages/web/.next/static
COPY --from=build /app/packages/web/public ./packages/web/public
COPY --from=build /tmp/migrate-bundle.mjs /app/migrate.mjs
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 \
    EE_DATA_DIR=/data EE_DB_PATH=/data/app.db EE_THUMBS_DIR=/data/thumbs \
    EE_BIN_DIR=/data/bin EE_YTDLP_PATH=/usr/local/bin/yt-dlp
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD curl -fsS http://localhost:3000/api/health || exit 1
CMD ["/docker-entrypoint.sh"]
