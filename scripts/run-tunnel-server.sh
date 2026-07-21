#!/bin/sh
# Bento hosted server for the iOS shell — run by the com.caleb.bento-server LaunchAgent.
# Serves the standalone Next build on 127.0.0.1:3100; cloudflared (separate agent)
# publishes it. Auth comes from .env.tunnel (gitignored: EE_AUTH_PASSCODE + EE_AUTH_SECRET).
# To rebuild + redeploy new code, run scripts/deploy-tunnel-server.sh instead of
# doing this by hand -- it builds, refreshes the standalone tree's static assets,
# migrates the DB the standalone server.js ACTUALLY opens (which is a different
# file than the repo-root one `npm run migrate` touches -- server.js resolves
# EE_DB_PATH relative to its own directory, not $REPO), then kickstarts this
# LaunchAgent. Skipping any one of those steps by hand is what caused the
# unstyled-CSS render and the "no such table: oauth_tokens" incidents.
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
set -a
. ./.env
. ./.env.tunnel
set +a
export PORT=3100 HOSTNAME=127.0.0.1
exec node packages/web/.next/standalone/packages/web/server.js
