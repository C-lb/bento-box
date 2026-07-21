#!/bin/sh
# One-shot redeploy for the Bento Box iOS tunnel server (com.caleb.bento-server).
# Replaces the old manual "build, copy static, migrate, kickstart" checklist that
# used to live as a comment in run-tunnel-server.sh — that checklist was getting
# skipped step-by-step (missing static copy -> unstyled app; migrate run against
# the wrong app.db -> stale schema), each time surfacing as a silent in-app error
# instead of a deploy failure. This script always runs every step, in order, and
# migrates the SAME app.db file the running server actually opens.
set -eu

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

STANDALONE_WEB="$REPO/packages/web/.next/standalone/packages/web"

echo "==> 1/4 build core + web"
npm -w @event-editor/core run build
npm -w @event-editor/web run build

echo "==> 2/4 refresh static assets in the standalone tree"
rm -rf "$STANDALONE_WEB/.next/static" "$STANDALONE_WEB/public"
cp -R "$REPO/packages/web/.next/static" "$STANDALONE_WEB/.next/static"
cp -R "$REPO/packages/web/public" "$STANDALONE_WEB/public"

echo "==> 3/4 migrate the DB the standalone server actually opens"
# The standalone server.js resolves EE_DB_PATH relative to ITS OWN directory
# ($STANDALONE_WEB), not the repo root -- so this must be an absolute path,
# not the repo-root-relative "./data/app.db" the top-level `npm run migrate`
# uses. Mirror .env's leaf filename so this stays correct if that ever changes.
DB_LEAF="$(grep '^EE_DB_PATH=' "$REPO/.env" | cut -d= -f2- | xargs basename)"
STANDALONE_DB="$STANDALONE_WEB/data/$DB_LEAF"
mkdir -p "$STANDALONE_WEB/data"
EE_DB_PATH="$STANDALONE_DB" npm -w @event-editor/core run migrate

echo "==> 4/4 restart the server"
launchctl kickstart -k "gui/$(id -u)/com.caleb.bento-server"

sleep 2
echo "==> done. verifying:"
curl -s -o /dev/null -w "  health: %{http_code}\n" http://127.0.0.1:3100/api/health || true
CSS_FILE="$(find "$STANDALONE_WEB/.next/static/chunks" -maxdepth 1 -name '*.css' 2>/dev/null | head -1 || true)"
if [ -n "$CSS_FILE" ]; then
  CSS_CHUNK="_next/static/chunks/$(basename "$CSS_FILE")"
  curl -s -o /dev/null -w "  css:    %{http_code}  ($CSS_CHUNK)\n" "http://127.0.0.1:3100/$CSS_CHUNK" || true
fi
