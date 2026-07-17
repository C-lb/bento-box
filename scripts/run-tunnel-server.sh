#!/bin/sh
# Bento hosted server for the iOS shell — run by the com.caleb.bento-server LaunchAgent.
# Serves the standalone Next build on 127.0.0.1:3100; cloudflared (separate agent)
# publishes it. Auth comes from .env.tunnel (gitignored: EE_AUTH_PASSCODE + EE_AUTH_SECRET).
# Rebuild + refresh the standalone tree before this picks up new code:
#   npm run build -w @event-editor/core && npm run build -w @event-editor/web
#   rm -rf packages/web/.next/standalone/packages/web/.next/static packages/web/.next/standalone/packages/web/public
#   cp -R packages/web/.next/static packages/web/.next/standalone/packages/web/.next/static
#   cp -R packages/web/public packages/web/.next/standalone/packages/web/public
#   npm run migrate && launchctl kickstart -k gui/$(id -u)/com.caleb.bento-server
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
set -a
. ./.env
. ./.env.tunnel
set +a
export PORT=3100 HOSTNAME=127.0.0.1
exec node packages/web/.next/standalone/packages/web/server.js
