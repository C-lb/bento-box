# Desktop App (Electron, macOS + Windows) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the existing event-editor (Next.js 16 server app + `@event-editor/core`) as a distributable native desktop app for macOS and Windows by wrapping the unchanged Next standalone server in Electron, with GitHub Actions producing both installers.

**Architecture:** The running app is `native window → loopback HTTP → unchanged Next server`. A new `packages/desktop` Electron package, on launch, points the data/font/port/OAuth env vars at per-user locations, runs migrations, forks the Next standalone `server.js` on a fixed loopback port (`4571`), waits for it, and opens a `BrowserWindow`. `core`/`web` are untouched apart from a small env-driven path/URL refactor (Phase 1) whose defaults preserve current `npm run dev` behaviour exactly.

**Tech Stack:** Electron, electron-builder, @electron/rebuild, Next.js 16 `output: "standalone"`, Node `child_process.fork` + `net`, GitHub Actions.

## Global Constraints

- **Personal, single-user tool.** No key-entry UI, no OS keychain, no hosted backend. Keys are read from a `.env` in the per-user data dir, NOT baked into the artifact.
- **Fixed loopback port `4571`** for the packaged app. If busy at launch, show a dialog and exit (the port is fixed because OAuth redirects are registered against it).
- **`EE_PUBLIC_URL`** default `http://localhost:3000` (dev), set to `http://127.0.0.1:4571` in the bundle. Google derives its redirect from it as-is; **Canva special-cases the host to `127.0.0.1`** (Canva rejects `localhost`). The Canva-only host swap is binding.
- **Path env vars default to today's values** so `npm run dev` and all existing tests are unchanged: `EE_DB_PATH`, `EE_HEADSHOT_DIR` (already exist), new `EE_THUMBS_DIR` (default `data/thumbs`), new `EE_FONT_PATH` (default `<cwd>/assets/fonts/DMSans-Medium.ttf`).
- **Existing suites must stay green:** `npm -w @event-editor/core run test` (69) and `npm -w @event-editor/web run test` (59). Web build: `npm -w @event-editor/web run build`.
- Web imports core via SUBPATH exports only; relative VALUE imports in `web` are EXTENSIONLESS (`import type` exempt).
- **No em dashes** in code, copy, or docs (house style). Sentence-case doc headings.
- **Out of scope:** code signing / notarization (unsigned builds), auto-update, tray icon. Do not add them.

## File Structure

**Create (web):** `packages/web/lib/paths.ts` (+ test `packages/web/test/paths.test.ts`, `packages/web/test/oauth-redirect.test.ts`).
**Modify (web):** `packages/web/lib/sorter.ts` (thumbs dir), `packages/web/lib/text-render.ts` (font path), `packages/web/lib/google/oauth.ts` (redirect default), `packages/web/lib/canva/oauth.ts` (Canva redirect host swap), `packages/web/next.config.ts` (`output: "standalone"` + tracing root), `.env.example`.
**Create (desktop):** `packages/desktop/package.json`, `packages/desktop/main.js`, `packages/desktop/preload.js`, `packages/desktop/.gitignore`, `packages/desktop/scripts/assemble-server.mjs`.
**Create (CI/docs):** `.github/workflows/desktop-build.yml`, `docs/setup/desktop.md`. **Modify:** `README.md`.

---

## Task 1: Web — `lib/paths.ts` path/URL helpers

**Files:**
- Create: `packages/web/lib/paths.ts`
- Test: `packages/web/test/paths.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `publicUrl(): string` (`process.env.EE_PUBLIC_URL ?? "http://localhost:3000"`); `thumbsDir(): string` (`process.env.EE_THUMBS_DIR ?? "data/thumbs"`); `fontPath(): string` (`process.env.EE_FONT_PATH ?? resolve(process.cwd(), "assets/fonts/DMSans-Medium.ttf")`). All read `process.env` at call time so tests can vary it.

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/test/paths.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { resolve } from "node:path";
import { publicUrl, thumbsDir, fontPath } from "../lib/paths";

const KEYS = ["EE_PUBLIC_URL", "EE_THUMBS_DIR", "EE_FONT_PATH"] as const;
afterEach(() => KEYS.forEach((k) => delete process.env[k]));

describe("paths helpers", () => {
  it("publicUrl defaults to localhost:3000, honours override", () => {
    expect(publicUrl()).toBe("http://localhost:3000");
    process.env.EE_PUBLIC_URL = "http://127.0.0.1:4571";
    expect(publicUrl()).toBe("http://127.0.0.1:4571");
  });
  it("thumbsDir defaults to data/thumbs, honours override", () => {
    expect(thumbsDir()).toBe("data/thumbs");
    process.env.EE_THUMBS_DIR = "/abs/thumbs";
    expect(thumbsDir()).toBe("/abs/thumbs");
  });
  it("fontPath defaults to the cwd-relative ttf, honours override", () => {
    expect(fontPath()).toBe(resolve(process.cwd(), "assets/fonts/DMSans-Medium.ttf"));
    process.env.EE_FONT_PATH = "/abs/font.ttf";
    expect(fontPath()).toBe("/abs/font.ttf");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/web run test -- paths`
Expected: FAIL — module `../lib/paths` not found.

- [ ] **Step 3: Implement**

```ts
// packages/web/lib/paths.ts
import { resolve } from "node:path";

export function publicUrl(): string {
  return process.env.EE_PUBLIC_URL ?? "http://localhost:3000";
}

export function thumbsDir(): string {
  return process.env.EE_THUMBS_DIR ?? "data/thumbs";
}

export function fontPath(): string {
  return process.env.EE_FONT_PATH ?? resolve(process.cwd(), "assets/fonts/DMSans-Medium.ttf");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @event-editor/web run test -- paths`
Expected: PASS (3/3).

- [ ] **Step 5: Document the new env vars**

Append to `.env.example` (hyphens, no em dashes):

```
# Desktop / packaging - base URL the app serves on (OAuth redirects derive from this)
EE_PUBLIC_URL=http://localhost:3000
# Filesystem locations (absolute in the packaged app; relative defaults for dev)
EE_THUMBS_DIR=data/thumbs
EE_FONT_PATH=
```

- [ ] **Step 6: Commit**

```bash
git add packages/web/lib/paths.ts packages/web/test/paths.test.ts .env.example
git commit -m "feat(web): paths helpers (publicUrl/thumbsDir/fontPath) + env docs"
```

---

## Task 2: Web — wire `thumbsDir()` + `fontPath()` into call sites

**Files:**
- Modify: `packages/web/lib/sorter.ts` (the two `resolve("data/thumbs", ...)` calls + the returned relative string), `packages/web/lib/text-render.ts` (the `loadSync` font path)
- Test: none new (covered by the existing web suite staying green)

**Interfaces:**
- Consumes: `thumbsDir`, `fontPath` from `./paths` (Task 1).

- [ ] **Step 1: Wire `thumbsDir()` into `sorter.ts`**

In `packages/web/lib/sorter.ts`, add to the existing imports (extensionless value import):

```ts
import { thumbsDir } from "./paths";
```

Replace the `saveThumbnail` body's path lines (currently `resolve("data/thumbs", String(jId))` and the `data/thumbs/...` return) with a `thumbsDir()`-based root:

```ts
          const root = thumbsDir();
          await mkdir(resolve(root, String(jId)), { recursive: true });
          await writeFile(resolve(root, String(jId), `${pId}.jpg`), bytes);
          return resolve(root, String(jId), `${pId}.jpg`);
```

Note: the returned path is now `resolve(root, ...)`. With the default `root = "data/thumbs"` this resolves to the same absolute path the `/api/thumb` route already produces when it `resolve()`s the stored value, so the thumb route is unaffected; in the bundle `root` is absolute so the stored path is absolute too.

- [ ] **Step 2: Wire `fontPath()` into `text-render.ts`**

In `packages/web/lib/text-render.ts`, replace the font load. New top of file:

```ts
import TextToSVG from "text-to-svg";
import { fontPath } from "./paths";

// Load once. fontPath() defaults to the cwd-relative ttf for dev and is an
// absolute bundle path in the packaged app.
const tts = TextToSVG.loadSync(fontPath());
```

(The `import { resolve } from "node:path"` line is no longer needed in this file if `resolve` was only used for the font path; remove it if now unused, keep it if used elsewhere in the file.)

- [ ] **Step 3: Verify the full web suite stays green**

Run: `npm -w @event-editor/web run test`
Expected: PASS (59/59 — fontPath default equals the old path, thumbsDir default equals the old dir).

- [ ] **Step 4: Grep that no cwd-relative filesystem reference remains in these two files**

Run: `grep -nE "process.cwd\(\)|\"data/thumbs\"" packages/web/lib/sorter.ts packages/web/lib/text-render.ts`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/sorter.ts packages/web/lib/text-render.ts
git commit -m "feat(web): thumbs + font paths via env-overridable helpers"
```

---

## Task 3: Web — OAuth redirects derive from `EE_PUBLIC_URL`

**Files:**
- Modify: `packages/web/lib/google/oauth.ts` (the `makeOAuthClient` redirect fallback), `packages/web/lib/canva/oauth.ts` (the `CANVA_REDIRECT` constant)
- Test: `packages/web/test/oauth-redirect.test.ts`

**Interfaces:**
- Consumes: `publicUrl` from `../paths` (google) / `../paths` (canva).
- Produces: `canvaRedirect(): string` exported from `packages/web/lib/canva/oauth.ts` (derives from `publicUrl()` with host forced to `127.0.0.1`); `CANVA_REDIRECT` remains an exported constant equal to `canvaRedirect()` for existing consumers.

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/test/oauth-redirect.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { makeOAuthClient } from "../lib/google/oauth";
import { canvaRedirect } from "../lib/canva/oauth";

afterEach(() => {
  delete process.env.EE_PUBLIC_URL;
  delete process.env.GOOGLE_REDIRECT_URI;
});

describe("google redirect", () => {
  it("defaults to localhost:3000 via EE_PUBLIC_URL", () => {
    const c = makeOAuthClient() as any;
    expect(c.redirectUri).toBe("http://localhost:3000/api/google/callback");
  });
  it("follows EE_PUBLIC_URL in the bundle", () => {
    process.env.EE_PUBLIC_URL = "http://127.0.0.1:4571";
    const c = makeOAuthClient() as any;
    expect(c.redirectUri).toBe("http://127.0.0.1:4571/api/google/callback");
  });
  it("GOOGLE_REDIRECT_URI overrides everything", () => {
    process.env.EE_PUBLIC_URL = "http://127.0.0.1:4571";
    process.env.GOOGLE_REDIRECT_URI = "http://example.test/cb";
    const c = makeOAuthClient() as any;
    expect(c.redirectUri).toBe("http://example.test/cb");
  });
});

describe("canva redirect", () => {
  it("defaults to 127.0.0.1:3000 (host forced even though base is localhost)", () => {
    expect(canvaRedirect()).toBe("http://127.0.0.1:3000/api/canva/callback");
  });
  it("follows EE_PUBLIC_URL in the bundle", () => {
    process.env.EE_PUBLIC_URL = "http://127.0.0.1:4571";
    expect(canvaRedirect()).toBe("http://127.0.0.1:4571/api/canva/callback");
  });
  it("forces 127.0.0.1 even if the base uses localhost on another port", () => {
    process.env.EE_PUBLIC_URL = "http://localhost:5000";
    expect(canvaRedirect()).toBe("http://127.0.0.1:5000/api/canva/callback");
  });
});
```

> Note on `c.redirectUri`: `google.auth.OAuth2` stores the third constructor arg as `redirectUri` on the instance. If the property name differs in the installed `google-auth-library`, read it from `(c as any).redirectUri ?? (c as any)._clientOptions?.redirectUri` and assert on that. Verify the actual property by logging it once during RED.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/web run test -- oauth-redirect`
Expected: FAIL — `canvaRedirect` not exported; google redirect still hardcoded `localhost:3000` regardless of `EE_PUBLIC_URL`.

- [ ] **Step 3: Update Google redirect fallback**

In `packages/web/lib/google/oauth.ts`, add the import (extensionless) and change the fallback:

```ts
import { publicUrl } from "../paths";
```

```ts
export function makeOAuthClient(): OAuth2Client {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI ?? `${publicUrl()}/api/google/callback`,
  );
}
```

- [ ] **Step 4: Update Canva redirect to a host-swapped helper**

In `packages/web/lib/canva/oauth.ts`, add the import and replace the constant with a helper + a constant computed from it:

```ts
import { publicUrl } from "../paths";
```

```ts
export function canvaRedirect(): string {
  // Canva rejects "localhost"; force the loopback host to 127.0.0.1.
  return `${publicUrl().replace("localhost", "127.0.0.1")}/api/canva/callback`;
}
export const CANVA_REDIRECT = canvaRedirect();
```

The existing consumers at the `buildAuthUrl` `redirect_uri` and `exchangeCode`/`refreshToken` `redirect_uri` keep using `CANVA_REDIRECT` unchanged.

> Caveat: `CANVA_REDIRECT` is captured at module load. In the packaged app the Electron main sets `EE_PUBLIC_URL` in the server's env BEFORE the server process starts (Task 5), so the constant captures the correct value. The test exercises `canvaRedirect()` directly (dynamic) to prove the logic.

- [ ] **Step 5: Run tests + existing canva/google suites**

Run: `npm -w @event-editor/web run test -- oauth-redirect canva google`
Expected: PASS — new redirect tests green; existing canva/google tests still green.

- [ ] **Step 6: Commit**

```bash
git add packages/web/lib/google/oauth.ts packages/web/lib/canva/oauth.ts packages/web/test/oauth-redirect.test.ts
git commit -m "feat(web): OAuth redirects derive from EE_PUBLIC_URL (Canva host-swapped to 127.0.0.1)"
```

---

## Task 4: Web — Next standalone output + server assembly script

**Files:**
- Modify: `packages/web/next.config.ts`
- Create: `packages/desktop/scripts/assemble-server.mjs`, `packages/desktop/.gitignore`
- Test: none (build + boot verification)

**Interfaces:**
- Produces: a runnable assembled server tree at `packages/desktop/build/server/` containing `packages/web/server.js`, traced `node_modules`, `.next/static`, `public`, and `assets/fonts/DMSans-Medium.ttf`. Consumed by Tasks 5 and 6.

- [ ] **Step 1: Enable standalone output with a monorepo tracing root**

In `packages/web/next.config.ts`, extend the config (keep the existing `loadEnvConfig` and `serverExternalPackages`):

```ts
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: resolve(here, "../.."),
  serverExternalPackages: ["better-sqlite3", "sharp", "@anthropic-ai/sdk", "ffmpeg-static", "ffprobe-static"],
};
```

(`here` and `resolve` are already imported at the top of the file.)

- [ ] **Step 2: Verify the standalone build emits a server**

Run: `npm -w @event-editor/web run build`
Then: `ls packages/web/.next/standalone/packages/web/server.js`
Expected: the file exists (monorepo standalone nests under `packages/web/`). If instead it emitted at `.next/standalone/server.js`, note the actual path in your report and use it in the assembly script.

- [ ] **Step 3: Write the assembly script**

```js
// packages/desktop/scripts/assemble-server.mjs
// Assembles a self-contained, runnable Next server tree into build/server.
import { cpSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");                 // monorepo root
const web = resolve(repo, "packages/web");
const standalone = resolve(web, ".next/standalone");
const out = resolve(here, "../build/server");

if (!existsSync(resolve(standalone, "packages/web/server.js"))) {
  throw new Error("standalone server.js missing - run `npm -w @event-editor/web run build` first");
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1. the whole standalone tree (server.js + traced node_modules, incl. @event-editor/core + native deps)
cpSync(standalone, out, { recursive: true });
// 2. static assets Next does not copy into standalone
cpSync(resolve(web, ".next/static"), resolve(out, "packages/web/.next/static"), { recursive: true });
if (existsSync(resolve(web, "public"))) {
  cpSync(resolve(web, "public"), resolve(out, "packages/web/public"), { recursive: true });
}
// 3. the font (read from disk at runtime via EE_FONT_PATH)
cpSync(resolve(web, "assets/fonts"), resolve(out, "packages/web/assets/fonts"), { recursive: true });

console.log("assembled server ->", out);
```

- [ ] **Step 4: Add the desktop `.gitignore`**

```
// packages/desktop/.gitignore
node_modules/
build/
dist/
```

- [ ] **Step 5: Assemble and boot the server standalone (no Electron yet)**

```bash
node packages/desktop/scripts/assemble-server.mjs
EE_DB_PATH="$PWD/packages/desktop/build/data/app.db" \
EE_HEADSHOT_DIR="$PWD/packages/desktop/build/data/headshots" \
EE_THUMBS_DIR="$PWD/packages/desktop/build/data/thumbs" \
EE_FONT_PATH="$PWD/packages/desktop/build/server/packages/web/assets/fonts/DMSans-Medium.ttf" \
EE_PUBLIC_URL="http://127.0.0.1:4571" PORT=4571 HOSTNAME=127.0.0.1 \
node packages/desktop/build/server/packages/web/server.js &
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4571/studio/batch
kill %1
```

Expected: `200`. (The db won't be migrated yet, so pages that query may error at runtime, but the server boots and serves the route shell. Migration is wired in Task 5.) If the server fails to find a native module, note which one — Task 6 handles the Electron-ABI rebuild.

- [ ] **Step 6: Commit**

```bash
git add packages/web/next.config.ts packages/desktop/scripts/assemble-server.mjs packages/desktop/.gitignore
git commit -m "feat(desktop): Next standalone output + server assembly script"
```

---

## Task 5: Desktop — Electron shell (`packages/desktop`)

**Files:**
- Create: `packages/desktop/package.json`, `packages/desktop/main.js`, `packages/desktop/preload.js`
- Test: none (manual smoke against a running dev server)

**Interfaces:**
- Consumes: the assembled server (Task 4) in production; in dev, an already-running `npm run dev` server.
- Produces: `npm -w @event-editor/desktop run dev` launches an Electron window. Used by Task 6 to package.

- [ ] **Step 1: Create the desktop package manifest**

```json
// packages/desktop/package.json
{
  "name": "@event-editor/desktop",
  "version": "0.0.1",
  "private": true,
  "main": "main.js",
  "scripts": {
    "dev": "EE_DESKTOP_DEV_URL=http://localhost:3000 electron .",
    "assemble": "node scripts/assemble-server.mjs",
    "dist": "npm run -w @event-editor/core build && npm run -w @event-editor/web build && npm run assemble && node scripts/rebuild-native.mjs && electron-builder"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0",
    "@electron/rebuild": "^3.6.0"
  }
}
```

> `electron` is CommonJS-friendly; `main.js` is written as CommonJS (`require`). Do not set `"type": "module"` in this package.

- [ ] **Step 2: Write `preload.js` (minimal, no privileged bridge)**

```js
// packages/desktop/preload.js
// Intentionally empty. The renderer talks to the local server over HTTP,
// so no IPC bridge is needed. Kept for an explicit, sandboxed preload.
```

- [ ] **Step 3: Write `main.js`**

```js
// packages/desktop/main.js
const { app, BrowserWindow, dialog, Menu } = require("electron");
const { fork } = require("node:child_process");
const { readFileSync, mkdirSync, existsSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const net = require("node:net");

const HOST = "127.0.0.1";
const PORT = 4571;
const BASE = `http://${HOST}:${PORT}`;

let serverProc = null;

// --- per-user env -----------------------------------------------------------
function loadDotEnv(file) {
  if (!existsSync(file)) {
    writeFileSync(
      file,
      [
        "# event-editor keys - fill these in. No quotes needed.",
        "GOOGLE_CLIENT_ID=",
        "GOOGLE_CLIENT_SECRET=",
        "GROQ_API_KEY=",
        "ANTHROPIC_API_KEY=",
        "CANVA_CLIENT_ID=",
        "CANVA_CLIENT_SECRET=",
        "",
      ].join("\n"),
    );
    return {};
  }
  const env = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

function serverEnv() {
  const userData = app.getPath("userData");
  const dataDir = path.join(userData, "data");
  mkdirSync(dataDir, { recursive: true });
  const keys = loadDotEnv(path.join(userData, ".env"));
  const fontPath = app.isPackaged
    ? path.join(process.resourcesPath, "server", "packages", "web", "assets", "fonts", "DMSans-Medium.ttf")
    : path.join(__dirname, "build", "server", "packages", "web", "assets", "fonts", "DMSans-Medium.ttf");
  return {
    ...process.env,
    ...keys,
    EE_DB_PATH: path.join(dataDir, "app.db"),
    EE_HEADSHOT_DIR: path.join(dataDir, "headshots"),
    EE_THUMBS_DIR: path.join(dataDir, "thumbs"),
    EE_FONT_PATH: fontPath,
    EE_PUBLIC_URL: BASE,
    PORT: String(PORT),
    HOSTNAME: HOST,
  };
}

// --- server lifecycle -------------------------------------------------------
function serverRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "server")
    : path.join(__dirname, "build", "server");
}

function runMigrations(env) {
  return new Promise((resolve, reject) => {
    const migrate = path.join(serverRoot(), "node_modules", "@event-editor", "core", "dist", "migrate.js");
    const p = fork(migrate, [], { env: { ...env, ELECTRON_RUN_AS_NODE: "1" }, stdio: "inherit" });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`migrate exited ${code}`))));
  });
}

function startServer(env) {
  const entry = path.join(serverRoot(), "packages", "web", "server.js");
  serverProc = fork(entry, [], { env: { ...env, ELECTRON_RUN_AS_NODE: "1" }, stdio: "inherit" });
}

function waitForPort(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = net.connect(PORT, HOST);
      sock.once("connect", () => { sock.destroy(); resolve(); });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error("server did not start"));
        else setTimeout(tryOnce, 250);
      });
    };
    tryOnce();
  });
}

function portInUse() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(true));
    srv.once("listening", () => srv.close(() => resolve(false)));
    srv.listen(PORT, HOST);
  });
}

// --- window -----------------------------------------------------------------
function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true, nodeIntegration: false },
  });
  win.loadURL(BASE);
}

async function boot() {
  const devUrl = process.env.EE_DESKTOP_DEV_URL;
  if (devUrl) {
    // dev: assume `npm run dev` is already serving; just open a window on it.
    new BrowserWindow({ width: 1200, height: 820 }).loadURL(devUrl);
    return;
  }
  if (await portInUse()) {
    dialog.showErrorBox("event-editor", `Port ${PORT} is already in use. Close whatever is using it and relaunch.`);
    app.quit();
    return;
  }
  const env = serverEnv();
  await runMigrations(env);
  startServer(env);
  await waitForPort();
  createWindow();
}

app.whenReady().then(boot).catch((e) => {
  dialog.showErrorBox("event-editor failed to start", String(e && e.stack ? e.stack : e));
  app.quit();
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => { if (serverProc) serverProc.kill(); });
```

- [ ] **Step 4: Install desktop deps**

Run: `npm install` (from the repo root; npm workspaces installs `packages/desktop` devDeps).
Expected: `electron`, `electron-builder`, `@electron/rebuild` resolve.

- [ ] **Step 5: Smoke-test the Electron window in dev mode**

In one terminal: `npm run dev` (serves on 3000). In another:
Run: `npm -w @event-editor/desktop run dev`
Expected: an Electron window opens to `http://localhost:3000`; navigate to `/studio/batch` and confirm it renders. Close the window.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/package.json packages/desktop/main.js packages/desktop/preload.js package-lock.json
git commit -m "feat(desktop): Electron shell (forks Next server, per-user data dir, dev mode)"
```

---

## Task 6: Desktop — electron-builder packaging + native rebuild

**Files:**
- Modify: `packages/desktop/package.json` (add the `build` electron-builder block)
- Create: `packages/desktop/scripts/rebuild-native.mjs`
- Test: none (local package build + manual smoke of the installed app)

**Interfaces:**
- Consumes: the assembled server (Task 4) and `main.js` (Task 5).
- Produces: a macOS `.dmg`/`.zip` (and on Windows, `.exe` installer/portable) under `packages/desktop/dist/`.

- [ ] **Step 1: Write the native-rebuild script**

The assembled server's `better-sqlite3` and `sharp` were built for the CI/system Node; rebuild them for Electron's ABI so they load under `ELECTRON_RUN_AS_NODE`.

```js
// packages/desktop/scripts/rebuild-native.mjs
import { rebuild } from "@electron/rebuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const electronVersion = require("electron/package.json").version;
const buildPath = resolve(here, "../build/server");   // rebuild the assembled server's node_modules

await rebuild({
  buildPath,
  electronVersion,
  onlyModules: ["better-sqlite3", "sharp"],
  force: true,
});
console.log("rebuilt native modules for electron", electronVersion);
```

> `ffmpeg-static` / `ffprobe-static` are plain executables (not node addons) and need no rebuild. If the smoke test later reveals another native addon failing to load, add it to `onlyModules`.

- [ ] **Step 2: Add the electron-builder `build` block to `packages/desktop/package.json`**

```json
  "build": {
    "appId": "sg.spark.eventeditor",
    "productName": "Event Editor",
    "directories": { "output": "dist" },
    "files": ["main.js", "preload.js"],
    "extraResources": [{ "from": "build/server", "to": "server" }],
    "asar": true,
    "mac": { "target": ["dmg", "zip"], "category": "public.app-category.productivity" },
    "win": { "target": ["nsis", "portable"] }
  }
```

> The whole Next server (including its native `node_modules`) ships as `extraResources` (plain unpacked files on disk), so no `asarUnpack` is needed: the Electron app code in the asar is tiny and pure-JS, and everything the forked server touches lives under `resources/server`.

- [ ] **Step 3: Build a local package (macOS)**

Run: `npm -w @event-editor/desktop run dist`
Expected: `electron-builder` produces `packages/desktop/dist/*.dmg` and `*.zip`. The `dist` script chain is: build core, build web (standalone), assemble server, rebuild native for Electron, package. If a step fails, fix and re-run.

- [ ] **Step 4: Smoke-test the installed app**

Open the produced `.dmg`, drag the app to Applications (or run the unpacked app under `dist/mac*/`), launch it (right-click -> Open the first time for Gatekeeper). Verify:
- The window opens (server forked, port reached).
- `/studio/batch` renders.
- A LOCAL headshot render produces a PNG (exercises `sharp` + the font under `EE_FONT_PATH`), confirming the native rebuild worked.
- The db file appears under `~/Library/Application Support/Event Editor/data/app.db` (migrations ran).

If `better-sqlite3` or `sharp` fail to load, the rebuild list or Electron/Node ABI is the cause - adjust `scripts/rebuild-native.mjs` (`onlyModules`) and rebuild. Record the resolution in your report.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/package.json packages/desktop/scripts/rebuild-native.mjs package-lock.json
git commit -m "feat(desktop): electron-builder packaging + native rebuild for Electron ABI"
```

---

## Task 7: CI — GitHub Actions builds both installers on tag

**Files:**
- Create: `.github/workflows/desktop-build.yml`
- Test: none (the workflow run is the verification)

- [ ] **Step 1: Write the workflow**

```yaml
# .github/workflows/desktop-build.yml
name: desktop-build
on:
  push:
    tags: ["v*"]

permissions:
  contents: write

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm -w @event-editor/desktop run dist
        env:
          # unsigned builds (personal use) - skip electron-builder code signing
          CSC_IDENTITY_AUTO_DISCOVERY: "false"
      - uses: softprops/action-gh-release@v2
        with:
          files: |
            packages/desktop/dist/*.dmg
            packages/desktop/dist/*.zip
            packages/desktop/dist/*.exe
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

> `npm ci` at the repo root installs all workspaces including `packages/desktop`. The `dist` script (Task 6) runs the full chain per platform; each runner produces only its own platform's artifacts, and the missing globs on each OS are skipped by the release action.

- [ ] **Step 2: Validate the workflow YAML locally**

Run: `node -e "require('js-yaml')" 2>/dev/null && npx --yes js-yaml .github/workflows/desktop-build.yml >/dev/null && echo "yaml ok" || echo "install js-yaml or eyeball the YAML"`
Expected: `yaml ok` (or a clean manual read - correct indentation, valid keys).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/desktop-build.yml
git commit -m "ci: build macOS + Windows desktop installers on tag"
```

- [ ] **Step 4: Trigger a real build (verification)**

```bash
git tag v0.0.1-desktop-test && git push origin v0.0.1-desktop-test
```

Watch the Actions run; expected: both matrix jobs go green and a GitHub release for the tag carries a `.dmg`, a `.zip`, and a Windows `.exe`. If a runner fails on native rebuild, fix `rebuild-native.mjs` / the `dist` chain and re-tag. Delete the test tag/release afterward if desired.

---

## Task 8: Docs — desktop setup guide

**Files:**
- Create: `docs/setup/desktop.md`
- Modify: `README.md`

- [ ] **Step 1: Write `docs/setup/desktop.md`**

Cover concretely, sentence-case headings, no em dashes:
1. **Keys file location.** macOS: `~/Library/Application Support/Event Editor/.env`. Windows: `%APPDATA%\Event Editor\.env`. On first launch the app writes a template there; fill in `GOOGLE_CLIENT_ID/SECRET`, `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `CANVA_CLIENT_ID/SECRET`, then relaunch.
2. **OAuth redirect URIs to register (one time).** Add `http://127.0.0.1:4571/api/google/callback` in the Google console and `http://127.0.0.1:4571/api/canva/callback` in the Canva console. The existing dev URIs (`localhost:3000` Google, `127.0.0.1:3000` Canva) stay as-is.
3. **First-run unsigned-app steps.** macOS: right-click the app -> Open -> Open (Gatekeeper). Windows: SmartScreen -> More info -> Run anyway.
4. **Data location.** The db, headshots, and thumbs live under the same per-user `Event Editor/data/` folder. Deleting it resets the app.
5. **Cutting a release.** Push a `v*` tag; the GitHub Actions release carries the macOS `.dmg`/`.zip` and Windows `.exe`. Download the one for your OS.
6. **Port note.** The app uses loopback port `4571`; if it reports the port is busy, close whatever holds it and relaunch.

- [ ] **Step 2: Add a README pointer**

In `README.md`, near the top or a "Desktop app" section, add: `Desktop builds (macOS + Windows): see \`docs/setup/desktop.md\`.`

- [ ] **Step 3: Commit**

```bash
git add docs/setup/desktop.md README.md
git commit -m "docs: desktop app setup (keys, OAuth redirects, releases)"
```

---

## Self-Review notes (author)

- **Spec coverage:** portable paths (T1/T2), fixed-port + `EE_PUBLIC_URL` with Canva host-swap (T3), Next standalone (T4), Electron shell + launch sequence + port-busy + keys-from-userData + migrate-on-boot (T5), native packaging + electron-builder targets (T6), CI matrix releases (T7), operator docs incl. console redirect URIs + Gatekeeper/SmartScreen (T8). Out-of-scope items (signing, auto-update, tray, key UI) are explicitly not built (T6 sets `CSC_IDENTITY_AUTO_DISCOVERY=false`; no updater).
- **Defaults preserve dev:** T1 helpers and T3 redirects default to today's exact values; T2 verifies the full web suite stays green and greps out residual cwd usage. Existing core/web suites are the regression net.
- **Type/interface consistency:** `publicUrl`/`thumbsDir`/`fontPath` (T1) are the only new web exports, consumed in T2/T3; `canvaRedirect()` (T3) is the testable unit, `CANVA_REDIRECT` stays the constant consumers use. The assembled server path `build/server/packages/web/server.js` (T4) is the exact path `main.js` forks (T5) and electron-builder ships as `resources/server` (T6).
- **Known iterative spot:** native-module ABI under Electron (T6) is the one place that may need a second pass - the rebuild list (`better-sqlite3`, `sharp`) is the expected set, with an explicit "add the failing module and rebuild" loop and a real smoke test (a local render) as the gate. T4 Step 5 surfaces native-load problems early, before Electron is involved.
- **Monorepo standalone path:** T4 Step 2 verifies the actual emitted `server.js` location and instructs falling back if Next nests it differently; every later path reference keys off that.
