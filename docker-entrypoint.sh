#!/bin/sh
set -e

# Fail closed on half-configured auth: EE_AUTH_PASSCODE without EE_AUTH_SECRET
# would leave authEnabled() false and the server silently unauthenticated
# (final-review.md Important #1). next.config.ts enforces this too at Next
# boot; this catches it earlier, before migrations/exec.
if [ -n "$EE_AUTH_PASSCODE" ] && [ -z "$EE_AUTH_SECRET" ]; then
  echo "FATAL: EE_AUTH_PASSCODE is set but EE_AUTH_SECRET is missing/blank." >&2
  echo "Refusing to start unauthenticated. Generate one with: openssl rand -hex 32" >&2
  exit 1
fi

mkdir -p /data/thumbs /data/bin
# getDb() does not auto-migrate (packages/core/src/db.ts just opens the file),
# so run migrations before every boot. The standalone Next output doesn't
# trace core's migrate.js (see Dockerfile comment) — it's esbuild-bundled to
# /app/migrate.mjs instead, with better-sqlite3 resolved from the real
# node_modules alongside it. Idempotent, so safe on every restart.
if [ -f /app/migrate.mjs ]; then node /app/migrate.mjs; fi
exec node /app/packages/web/server.js
