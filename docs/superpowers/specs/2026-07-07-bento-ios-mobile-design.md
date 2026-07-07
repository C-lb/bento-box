# Bento on iPhone — hosted server, mobile UI, iOS shell

**Date:** 2026-07-07
**Status:** Approved design, pre-plan
**Decisions locked with Caleb:** hosted server + Capacitor app shell (not PWA-only, not on-device processing); SPARK-team access behind a login; hosting must be free.

## Goal

Bento's 13 tools usable from an iPhone, as a real home-screen app. Processing stays server-side because iOS cannot ship or spawn the binaries the tools depend on (ffmpeg, LibreOffice, yt-dlp) and has no local Node server. The desktop Electron app is untouched.

## Architecture

Three components, built in this order. Each is independently shippable.

### 1. Server-ready Bento (Docker)

One Docker image, linux/arm64 (and amd64 for local testing):

- Base: `node:22-slim` (Debian, so `apt` can install the binaries).
- Baked in: `ffmpeg`, `libreoffice` (headless packages only), `yt-dlp` (static binary), plus fonts (`fonts-dejavu` + Noto CJK) so LibreOffice renders slides correctly.
- App: built `@event-editor/core` + `@event-editor/web`, started with `next start`.
- State: SQLite DB and working files on a mounted volume, wired through the **existing** `EE_DB_PATH` / `EE_DATA_DIR` / `EE_BIN_DIR` env vars — no new persistence code. In-container yt-dlp uses the baked binary; the Settings > Dependencies downloader is bypassed when a system `yt-dlp` is on PATH (small resolver tweak if needed).
- Public URL + TLS: **Cloudflare Tunnel** (`cloudflared` as a second container/service in a `docker-compose.yml`). No open ports, free, and the same compose file runs unchanged on the fallback host.

**Hosting: Oracle Cloud Always Free** — Ampere A1 ARM VM (up to 4 OCPU / 24 GB RAM / 200 GB disk), free forever. Fallback if signup or region capacity fails: an always-on office Mac running the same compose file with the same tunnel. Everything below is host-agnostic.

Known risk, tested first: LibreOffice and ffmpeg behaviour on arm64 Debian in Docker. A per-tool real-file round trip inside the container is a gate before any frontend work depends on it.

### 2. Auth gate

- Next.js `middleware.ts` in `packages/web` guarding **all** pages and API routes except `/login`, static assets, and health.
- Model: one shared SPARK passcode (env `EE_AUTH_PASSCODE`) → on success, a signed `httpOnly` cookie (HMAC over an expiry timestamp, secret from `EE_AUTH_SECRET`), lifetime ~90 days. No user table, no accounts.
- `EE_AUTH_DISABLED=1` (default when `EE_AUTH_PASSCODE` unset) → middleware passes everything through. Electron desktop and local dev see zero change.
- Login page styled to the shell (anti-vibecode: neutral system, one accent, 17px mobile type).
- Rate-limit login attempts (in-memory counter is fine; single instance).
- **Upload caps** enforced server-side per tool class: 2 GB video/splice, 500 MB audio, 100 MB images/PDF/slides. Clear error toast on breach.

### 3. Mobile frontend + iOS shell

**Responsive pass at 390 px** over the tool shell and all 13 tools (`/sorter /studio /transcribe /slice /convert /heic /resize /pdf /video /splice /qr /cutout /settings`, plus `badge/certificate/place-card/ticket` doc generators if routable from the shell). Anti-vibecode standards apply: 17 px base type, 48 px touch targets, 2–4 col mobile grid, sentence-case, one accent. Shell topbar group pills become horizontally scrollable or collapse into a sheet where they overflow.

iOS specifics:

- `<input type="file" accept=…>` tuned per tool so the camera roll / Files picker opens with the right media type.
- Visible upload progress (XHR/fetch streams) for anything over a few MB — mobile uplink makes silent uploads feel broken.
- Job-status UIs (transcribe, video, splice, convert, slice) must resume cleanly on tab refocus: re-poll on `visibilitychange`, never assume a live connection survived the phone locking.
- Client-side tools (QR, cutout/MediaPipe, PDF ops) already run in-browser; verify on iOS Safari (MediaPipe wasm + memory is the one to watch) but expect no changes.

**Capacitor iOS shell**, same pattern as Nexus (reuse its runbook at `~/nexus/docs/setup/mobile.md` as the template):

- `server.url` → the hosted URL; `server.errorPath` → bundled offline card (the Nexus whole-branch lesson: without `errorPath` the offline page is bundled but unreachable).
- Safe-area tokens, StatusBar theme sync (tokens UPPERCASE `'LIGHT'`/`'DARK'`).
- Bento icon + splash from the existing v0.0.9 icon asset.
- Lives in `packages/mobile` (untracked native build artefacts gitignored, like Nexus's `android/` scaffolding approach).

## Error handling

- Server job failures already surface via the job model; ensure every tool shows the failure state on mobile (not just a stuck spinner).
- Tunnel/host down → Capacitor `errorPath` offline card.
- Auth cookie expired mid-upload → 401 handled with a redirect to `/login`, not a silent hang.

## Testing

1. **Container gate (first):** scripted real-file round trip per server-side tool inside the arm64 container — sorter, studio, transcribe, slice, convert, heic, resize, pdf, video, splice. Pass/fail table before frontend work.
2. **390 px Playwright smoke** against the running container (reuse the auth-stubbed make-harness pattern), one happy path per tool.
3. **Manual:** Caleb's real-device walk on iPhone Safari first (day-one usable), then the Capacitor build.

## Caleb's personal to-dos

- Create the Oracle Cloud account (or nominate the fallback Mac).
- Choose the SPARK passcode.
- Apple Developer account ($99/yr) when the Capacitor shell is ready for TestFlight — free 7-day provisioning works for personal-device testing before that. Mobile web works with no Apple account at all.

## Out of scope

Offline/on-device processing, per-user accounts, Android shell (same Capacitor project later), App Store review polish, payments/quotas.
