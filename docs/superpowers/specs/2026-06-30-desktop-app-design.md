# Desktop App (Windows + macOS) — Design

**Status:** Approved (brainstorm 2026-06-30)
**Goal:** Package the existing event-editor (Next.js 16 server app + `@event-editor/core`) as a distributable native desktop application for macOS and Windows, without rewriting the backend.

## Context

event-editor today is a two-package npm-workspaces monorepo:
- `@event-editor/core` — SQLite + Drizzle (`better-sqlite3`).
- `@event-editor/web` — Next.js 16 (App Router, nodejs runtime) with three tools (Drive photo sorter, headshot studio incl. sheet-driven batch, audio transcriber).

It runs as `next start` on a hardcoded port 3000. It has heavy Node-native dependencies: `better-sqlite3` (compiled addon), `sharp` (libvips), `ffmpeg-static` / `ffprobe-static` (prebuilt platform binaries), plus `googleapis`, `archiver`, `@anthropic-ai/sdk`, `text-to-svg`.

Three things break the moment it is packaged: data paths are cwd-relative (`data/app.db`, `data/headshots`, `data/thumbs`, and the font via `process.cwd()`), the port is hardcoded to 3000, and the OAuth redirect URIs are hardcoded to `localhost:3000` / `127.0.0.1:3000`.

## Decisions (locked in brainstorm)

- **Audience:** personal use only (Caleb's own Mac + Windows machines). The app uses Caleb's own API keys. No key-entry UI, no OS keychain, no hosted backend.
- **Keys:** loaded from a `.env` in the per-user data dir, NOT baked into the shipped artifact. Editable without a rebuild; kept out of the distributable.
- **Packaging tech:** Electron, wrapping the unchanged Next.js standalone server (chosen over Tauri-with-Node-sidecar and a packaged-server-plus-browser; both add engineering specifically to fight the Node-native backend).
- **Builds:** GitHub Actions CI with a macOS runner + a Windows runner produces both installers as release assets. No second physical machine required.
- **Signing/notarization, auto-update, tray icon:** out of scope (see Out of Scope).

## Architecture

The running app is: **native window → loopback HTTP → the unchanged Next.js server.** Electron wraps the app; it does not replace the backend.

A new workspace package `packages/desktop` holds the Electron layer. `core` and `web` are untouched except for the small env-driven path/URL refactor below. Next.js switches to `output: "standalone"`, which emits a self-contained `.next/standalone/server.js` plus a trimmed `node_modules`.

### Launch sequence (Electron main process)

On `app.whenReady()`:
1. **Resolve data dir** — `app.getPath('userData')` (`~/Library/Application Support/event-editor` on macOS, `%APPDATA%\event-editor` on Windows). Compute absolute paths for the db, headshots, thumbs, and font under it (or, for the font, its unpacked bundle location).
2. **Load keys** — read `userData/.env`. If absent, write a commented template there and continue (the app launches; cloud features show their existing "not configured" states until keys are filled in).
3. **Migrate** — run `runMigrations` against the userData db.
4. **Start server** — fork the standalone `server.js` as a child process using Electron's bundled Node (`ELECTRON_RUN_AS_NODE=1`), with the resolved env injected (`PORT=4571`, `EE_DB_PATH`, `EE_HEADSHOT_DIR`, `EE_THUMBS_DIR`, `EE_FONT_PATH`, `EE_PUBLIC_URL=http://127.0.0.1:4571`, plus the loaded keys). Wait until the port accepts a TCP connection.
5. **Open window** — create a `BrowserWindow` and `loadURL('http://127.0.0.1:4571')`.

On `window-all-closed` / `before-quit`: kill the server child process, then quit.

If port 4571 is already in use at launch, show a clear dialog and exit (the port is fixed because OAuth redirects are registered against it; silently moving it would break OAuth).

### Why fork the server rather than run it in-process

Forking with `ELECTRON_RUN_AS_NODE` runs `server.js` under Electron's own Node, so `better-sqlite3` only needs to match one ABI (Electron's). `sharp` and `ffmpeg` are ABI-independent (separate binaries / processes). Keeping the server in a child process also gives a clean kill on quit and isolates a server crash from the window.

## Components

### 1. Portable paths + config (refactor in `core`/`web` — independently shippable)

Make every cwd-relative filesystem reference env-overridable, with the current value as the default, so `npm run dev` is byte-for-byte unchanged and all existing tests stay green.

| Concern | Today | Change |
|---|---|---|
| DB path | `EE_DB_PATH` (already) | keep |
| Headshots dir | `EE_HEADSHOT_DIR` (already) | keep |
| Thumbnails dir | hardcoded `resolve("data/thumbs", ...)` in `packages/web/lib/sorter.ts` | new `EE_THUMBS_DIR` (default `data/thumbs`) |
| Font path | `resolve(process.cwd(), "assets/fonts/DMSans-Medium.ttf")` in `packages/web/lib/text-render.ts` | new `EE_FONT_PATH` (default the current cwd-relative path) |

When the four are absolute (as the Electron main sets them), every downstream `resolve(outputPath)` in the image/zip/thumb routes becomes a no-op — so cwd dependence is removed everywhere, not just at these four sites.

**Interface:** these are plain `process.env` reads at the existing call sites, defaulted with `??`. No new module is required, though a tiny `paths` helper in `web/lib` is acceptable if it reads cleaner. Keys remain ordinary `process.env` reads; the Electron main is responsible for populating `process.env` from `userData/.env` before the server starts.

### 2. Fixed port + `EE_PUBLIC_URL` (refactor in `web`)

A single `EE_PUBLIC_URL` env becomes the base both callbacks derive from. **Google uses the base host as-is; Canva special-cases the host to `127.0.0.1`** because Canva rejects `localhost` outright (a known gotcha in this project) while Google's dev redirect is registered against `localhost`. Keeping the swap inside Canva alone means the dev Google setup is untouched.

- `EE_PUBLIC_URL` — default `http://localhost:3000` (dev), set to `http://127.0.0.1:4571` in the bundle.
- **Google** (`packages/web/lib/google/oauth.ts:15`) already reads `GOOGLE_REDIRECT_URI ?? "http://localhost:3000/api/google/callback"`. Change the fallback to `${EE_PUBLIC_URL}/api/google/callback`, keeping `GOOGLE_REDIRECT_URI` as a higher-priority explicit override for back-compat. Dev resolves to `localhost:3000` (matches the existing registration); the bundle resolves to `127.0.0.1:4571`.
- **Canva** (`packages/web/lib/canva/oauth.ts:3`) is a hardcoded `export const CANVA_REDIRECT = "http://127.0.0.1:3000/api/canva/callback"`. Change it to derive from `EE_PUBLIC_URL` with the host forced to `127.0.0.1` (e.g. `${EE_PUBLIC_URL.replace("localhost", "127.0.0.1")}/api/canva/callback`); it is consumed at lines 35 and 66 of the same file, so the single constant is the only edit point. Dev resolves to `127.0.0.1:3000` (matches the existing Canva registration); the bundle resolves to `127.0.0.1:4571`. This Canva-only host swap is a binding requirement — deriving Canva's redirect from a `localhost` base would break Canva auth.

**Operator action (documented, one-time):** add `http://127.0.0.1:4571/api/google/callback` to the Google console and `http://127.0.0.1:4571/api/canva/callback` to the Canva console (the bundle URIs). The existing dev URIs (`localhost:3000` Google, `127.0.0.1:3000` Canva) stay as-is — no dev re-registration needed.

### 3. Electron shell (`packages/desktop`, new)

- `main.ts` — the launch sequence above (data dir, env, migrate, fork server, window, quit cleanup, port-busy dialog), plus a small `waitForPort` helper and a small dotenv parse for `userData/.env`.
- `preload.ts` — minimal; no privileged bridge is needed (the UI talks to the local server over HTTP, not IPC). Sandbox on, `nodeIntegration` off in the renderer.
- A default application menu (standard edit/view/window roles); no custom tray.
- `electron-builder` config (in `packages/desktop/package.json` or `electron-builder.yml`).

### 4. Native modules + electron-builder packaging

- `better-sqlite3` — rebuilt against Electron's ABI (electron-builder `npmRebuild`) and `asarUnpack`'d.
- `sharp` (libvips) and `ffmpeg-static` / `ffprobe-static` — prebuilt per-platform binaries, `asarUnpack`'d. CI builds on each platform, so the correct binaries are installed per build.
- The DM Sans `.ttf` — `asarUnpack`'d (read from disk at runtime; `EE_FONT_PATH` points at the unpacked copy).
- `archiver` and the SDKs — pure JS, stay inside the asar.
- Targets: **dmg + zip** (macOS), **nsis installer + portable exe** (Windows).

### 5. CI (`.github/workflows/desktop-build.yml`, new)

Triggered on a version tag (`v*`). Matrix: `[macos-latest, windows-latest]`. Per runner: checkout → setup-node → `npm ci` → build core → build web (standalone) → `electron-builder` for the host platform → upload the installer(s) as assets on the GitHub release for the tag. Unsigned builds (see Out of Scope).

## Data flow

Renderer (BrowserWindow) issues normal HTTP/fetch to `http://127.0.0.1:4571/...`, exactly as the browser does today against `localhost:3000`. The Next server reads/writes the db and media under the userData dir, calls Google/Groq/Anthropic/Canva using the keys injected from `userData/.env`, and OAuth callbacks land back on `http://127.0.0.1:4571/...`. Nothing about the request/response paths inside `web` changes.

## Error handling

- **Port busy at launch:** dialog + exit (port is fixed for OAuth).
- **Missing keys:** app still launches; a freshly-written `userData/.env` template invites the user to add keys; cloud features render their existing not-configured/error states until keys exist.
- **Server child crash:** the window shows a load error; quitting kills any orphan. (Auto-restart is a possible later enhancement, not in this scope.)
- **OAuth redirect mismatch** (port not registered in a console): surfaces as the provider's own error in the existing callback handling; the setup doc calls this out as the first thing to check.

## Testing

- The path/URL refactor is env-var plumbing with current-value defaults: the existing `core` (69) and `web` (59) vitest suites must stay green, proving no dev regression. Add a small unit test asserting the new defaults (`EE_THUMBS_DIR`, `EE_FONT_PATH`, `EE_PUBLIC_URL`) resolve to today's values when unset, and to the override when set.
- The Electron shell is verified by a **manual smoke test** of a locally-built package: window opens, `/studio/batch` loads, a local headshot render produces a PNG, and (with keys present) one cloud call succeeds. Electron packaging is not meaningfully unit-testable.
- CI success = both installers produced as release assets.

## Sequencing (for the implementation plan)

1. **Portable paths + `EE_PUBLIC_URL` refactor** — in `core`/`web`, independently shippable and fully test-covered; no Electron yet.
2. **Electron shell** — `packages/desktop` (main/preload, launch sequence, electron-builder config), Next `output: "standalone"`, native-module unpacking; produce a working local macOS package and smoke-test it.
3. **CI workflow** — the 2-runner matrix producing both installers on tag.

## Out of Scope

- **Code signing / notarization.** Builds ship unsigned. The setup doc covers macOS right-click → Open (Gatekeeper) and Windows SmartScreen "More info → Run anyway". Can be added later (needs an Apple Developer account + a Windows code-signing cert).
- **Auto-update** (`electron-updater`).
- **Tray icon / background running.**
- **Key-entry UI / OS keychain** — keys are supplied via the userData `.env`.
- **Hosted backend / multi-user distribution** — explicitly a personal, single-user tool.

## Operator setup (to be written into `docs/setup/desktop.md` during implementation)

1. Where `userData/.env` lives per platform and which keys it needs (`GOOGLE_CLIENT_ID/SECRET`, `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `CANVA_CLIENT_ID/SECRET`).
2. The two console redirect URIs to add (`127.0.0.1:4571` Google + Canva callbacks).
3. First-run Gatekeeper / SmartScreen steps for the unsigned build.
4. How to cut a release (push a `v*` tag → download both installers from the GitHub release).
