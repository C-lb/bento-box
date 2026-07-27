#!/bin/sh
# Bento hosted server for the iOS shell — run by the com.caleb.bento-server LaunchAgent.
# Serves the standalone Next build on 127.0.0.1:3100; the Tailscale funnel
# (https://calebs-macbook-pro.tailba0755.ts.net) publishes it.
# Auth comes from .env.tunnel (gitignored: EE_AUTH_PASSCODE + EE_AUTH_SECRET).
#
# To rebuild + redeploy new code, run scripts/deploy-tunnel-server.sh instead of
# doing this by hand -- it builds, refreshes the standalone tree's static assets,
# migrates the DB the standalone server.js ACTUALLY opens (which is a different
# file than the repo-root one `npm run migrate` touches -- server.js resolves
# EE_DB_PATH relative to its own directory, not $REPO), then kickstarts this
# LaunchAgent. Skipping any one of those steps by hand is what caused the
# unstyled-CSS render and the "no such table: oauth_tokens" incidents.
#
# NEVER go back to `set -a; . ./.env`. Sourcing a .env runs it as a shell script,
# so any unquoted |, &, ;, (, ), $, or backtick in a VALUE gets executed. That is
# exactly what took the tunnel down on 2026-07-27: EE_UNLOCK_CODES=sparkbento:groq|claude
# was parsed as a pipe into `claude`, which is not on launchd's PATH, so the script
# died with 127 and KeepAlive crash-looped it forever behind a 502 funnel.
# load_env below PARSES the file instead — values are treated as literal text.
set -eu

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
fatal() { log "FATAL $*"; exit 1; }

# Parse a KEY=VALUE file and export each pair literally. Supports blank lines,
# # comments, an optional `export ` prefix, and optional matching single/double
# quotes around the value. No expansion, no command substitution, no globbing.
CR="$(printf '\r')"
TAB="$(printf '\t')"

load_env() {
  _file="$1"
  [ -r "$_file" ] || fatal "env file missing or unreadable: $_file"
  _lineno=0
  # `|| [ -n "$_line" ]` so a final line with no trailing newline is still read.
  while IFS= read -r _line || [ -n "$_line" ]; do
    _lineno=$((_lineno + 1))
    _line="${_line%"$CR"}"                     # strip a stray CR (CRLF file)
    while :; do                                # strip surrounding whitespace
      case "$_line" in
        ' '*) _line="${_line# }" ;;
        "$TAB"*) _line="${_line#"$TAB"}" ;;
        *' ') _line="${_line% }" ;;
        *"$TAB") _line="${_line%"$TAB"}" ;;
        *) break ;;
      esac
    done
    case "$_line" in
      ''|'#'*) continue ;;
      'export '*) _line="${_line#export }" ;;
    esac
    case "$_line" in
      *=*) ;;
      *) log "WARN $_file:$_lineno ignored, no '=' found"; continue ;;
    esac
    _key="${_line%%=*}"
    _val="${_line#*=}"
    case "$_key" in
      ''|*[!A-Za-z0-9_]*|[0-9]*)
        log "WARN $_file:$_lineno ignored, not a valid variable name"
        continue ;;
    esac
    # Strip one layer of matching surrounding quotes, if present.
    case "$_val" in
      \"*\") _val="${_val#\"}"; _val="${_val%\"}" ;;
      \'*\') _val="${_val#\'}"; _val="${_val%\'}" ;;
    esac
    export "$_key=$_val"
  done < "$_file"
  unset _file _lineno _line _key _val
}

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

load_env ./.env
load_env ./.env.tunnel

SERVER="packages/web/.next/standalone/packages/web/server.js"

# Preflight: fail with a readable reason instead of a silent 127 crash-loop.
command -v node >/dev/null 2>&1 || fatal "node not on PATH ($PATH) — check the LaunchAgent PATH key"
[ -f "$SERVER" ] || fatal "standalone build missing: $REPO/$SERVER — run scripts/deploy-tunnel-server.sh"
for _req in EE_AUTH_PASSCODE EE_AUTH_SECRET; do
  eval "_v=\${$_req:-}"
  [ -n "$_v" ] || fatal "$_req is empty — check .env.tunnel"
done
unset _req _v

export PORT=3100 HOSTNAME=127.0.0.1
log "starting bento server: node $(node --version) -> $HOSTNAME:$PORT"
exec node "$SERVER"
