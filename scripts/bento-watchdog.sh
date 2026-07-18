#!/bin/sh
# Bento uptime watchdog.
#
# Keeps the phone -> Mac chain healthy and self-heals silent failures.
# Chain:  Bento Box app  ->  https://<funnel>  ->  Tailscale funnel  ->  tailscaled  ->  127.0.0.1:3100 server
#
# Runs every 60s from the com.caleb.bento-watchdog LaunchAgent.
# The single point of truth for "is the phone able to reach Bento" is the PUBLIC
# funnel URL — we check that from the outside in, because that is exactly what the
# phone sees. If it is 200 we do nothing (and stay quiet). If not, we walk the
# chain, repair whatever broke, re-check, and notify.
set -u

TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale
FUNNEL_URL="https://calebs-macbook-pro.tailba0755.ts.net/login"
LOCAL_URL="http://localhost:3100/"
UID_NUM="$(id -u)"
LOG="/Users/caleb/Library/Logs/bento-watchdog.log"
NTFY_TOPIC="bento-wd-4aa46fd4bb-caleb"   # phone subscribes to this topic in the ntfy app

STATE="/Users/caleb/Library/Logs/bento-watchdog.state"   # remembers last-seen tailscaled PID

ts()     { date "+%Y-%m-%d %H:%M:%S"; }
log()    { echo "$(ts) $*" >> "$LOG"; }
probe()  { curl -s -o /dev/null -w '%{http_code}' --max-time "$2" "$1" 2>/dev/null; }
refunnel() { $TS serve reset >/dev/null 2>&1; sleep 1; $TS funnel --bg 3100 >>"$LOG" 2>&1; sleep 2; }
# notify(message, title, priority, tags) — macOS banner (when at Mac) + ntfy push (to phone)
notify() {
  osascript -e "display notification \"$1\" with title \"$2\"" >/dev/null 2>&1
  curl -s --max-time 8 \
    -H "Title: $2" -H "Priority: ${3:-default}" -H "Tags: ${4:-}" \
    -d "$1" "https://ntfy.sh/$NTFY_TOPIC" >/dev/null 2>&1
}

# --- restart detection: Tailscale restarting leaves the funnel PUBLICLY stale --
# (tailnet path still answers 200, so the health probe below can't see it). The
# extension PID changes only on a real Tailscale restart — the exact trigger for a
# stale funnel. On a change, refresh the funnel ingress proactively.
cur_pid="$(pgrep -f 'io.tailscale.ipn.macsys.network-extension' | head -1)"
old_pid="$(cat "$STATE" 2>/dev/null)"
if [ -n "$cur_pid" ] && [ -n "$old_pid" ] && [ "$cur_pid" != "$old_pid" ]; then
  log "Tailscale restarted (pid $old_pid -> $cur_pid) — refreshing funnel ingress"
  refunnel
  notify "Tailscale restarted — funnel refreshed, phone access kept alive." "Bento watchdog" "default" "arrows_counterclockwise"
fi
[ -n "$cur_pid" ] && printf '%s' "$cur_pid" > "$STATE"

# --- fast path: healthy -> exit silently, no log spam -----------------------
code="$(probe "$FUNNEL_URL" 12)"
[ "$code" = "200" ] && exit 0

log "UNHEALTHY funnel=$code — starting heal"

# --- 1. local :3100 server -------------------------------------------------
lcode="$(probe "$LOCAL_URL" 8)"
if [ "$lcode" = "000" ]; then
  log "  local :3100 down (code=$lcode) — kickstarting bento-server"
  launchctl kickstart -k "gui/$UID_NUM/com.caleb.bento-server" 2>>"$LOG"
  sleep 5
fi

# --- 2. Tailscale up + connected -------------------------------------------
# The funnel/serve config persists in tailscaled state, so simply getting
# Tailscale running again restores the funnel — no need to re-assert it.
if ! $TS status >/dev/null 2>&1; then
  log "  tailscale stopped — relaunching app"
  open -a Tailscale
  sleep 6
fi
$TS up >/dev/null 2>>"$LOG"
sleep 3

# Belt-and-braces: if somehow the funnel config was lost, re-assert it.
if ! $TS serve status 2>/dev/null | grep -q "3100"; then
  log "  funnel config missing — re-asserting funnel on :3100"
  $TS funnel --bg 3100 >>"$LOG" 2>&1
  sleep 3
fi

# --- 3. re-check ------------------------------------------------------------
code="$(probe "$FUNNEL_URL" 12)"
if [ "$code" = "200" ]; then
  log "HEALED funnel=200"
  notify "Recovered — phone access to Bento restored." "Bento watchdog" "default" "white_check_mark"
  exit 0
fi

log "STILL UNHEALTHY funnel=$code after heal attempt"
notify "Could NOT restore Bento phone access (funnel=$code). Check the Mac." "Bento watchdog" "high" "warning"
exit 1
