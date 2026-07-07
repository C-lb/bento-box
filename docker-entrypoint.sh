#!/bin/sh
set -e
mkdir -p /data/thumbs /data/bin
# getDb() does not auto-migrate (packages/core/src/db.ts just opens the file),
# so run migrations before every boot. The standalone Next output doesn't
# trace core's migrate.js (see Dockerfile comment) — it's esbuild-bundled to
# /app/migrate.mjs instead, with better-sqlite3 resolved from the real
# node_modules alongside it. Idempotent, so safe on every restart.
if [ -f /app/migrate.mjs ]; then node /app/migrate.mjs; fi
exec node /app/packages/web/server.js
