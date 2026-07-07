# Bento iOS/Mobile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bento's tools usable from an iPhone: Dockerised server (free Oracle ARM VM or office Mac, Cloudflare Tunnel), passcode auth gate, 390px-ready UI, Capacitor iOS shell.

**Architecture:** The existing Next 16 app (`output: "standalone"`) is packaged into a linux/arm64 Docker image with LibreOffice + yt-dlp baked in (ffmpeg already comes from the `ffmpeg-static` npm dep). A Next middleware gates every route behind a signed cookie when `EE_AUTH_PASSCODE` is set — desktop/local stays auth-free. The frontend gets a mobile pass (shell + per-tool batches), then a thin Capacitor shell points `server.url` at the hosted URL.

**Tech Stack:** Next 16 (app router, standalone), Tailwind 3 (custom tokens), vitest, Docker + docker-compose, cloudflared, Capacitor 7.

**Spec:** `docs/superpowers/specs/2026-07-07-bento-ios-mobile-design.md`

## Global Constraints

- Work in `~/event-editor`. Commit each task to `main` and push (Caleb's standing rule: no branches, no asking).
- Never commit the real passcode or tunnel token. Real values live only in gitignored `.env.server` on the server. (Caleb's passcode is set out-of-band.)
- All tests: `npm -w @event-editor/web run test` (vitest, files in `packages/web/test/*.test.ts`). Build check: `npm run build` at repo root.
- Turbopack gotcha: no extensionless relative imports in `packages/web`.
- Desktop app must be unaffected: with `EE_AUTH_PASSCODE` unset, behaviour is byte-for-byte today's. Do not touch `packages/desktop`.
- UI work follows anti-vibecode: one accent (`accent` token `#3b6cf6`), neutral rest, existing Tailwind tokens (`canvas/surface/line/ink/muted/success/danger`, `shadow-soft`, `rounded-card`), sentence case, no em dashes in copy, ≥44px touch targets on mobile, `text-amber-600` for warnings (there is no `text-warning` token).
- Mobile verification viewport: 390×844 (iPhone), via the Playwright MCP browser against `npm run dev` on port 3000.
- Env vars the server honours (all pre-existing except the `EE_AUTH_*` pair added here): `EE_DB_PATH`, `EE_DATA_DIR`, `EE_BIN_DIR`, `EE_THUMBS_DIR`, `EE_YTDLP_PATH`, `EE_FONT_PATH`, `EE_PUBLIC_URL`; new: `EE_AUTH_PASSCODE`, `EE_AUTH_SECRET`, `EE_AUTH_DISABLED`.

---

### Task 1: Health endpoint

**Files:**
- Create: `packages/web/app/api/health/route.ts`
- Test: `packages/web/test/health-route.test.ts`

**Interfaces:**
- Produces: `GET /api/health` → `200 {"ok":true,"deps":[{"id":"ffmpeg","ready":true},...]}`. Consumed by Task 2's Dockerfile HEALTHCHECK, Task 3's smoke script, and always exempt from auth (Task 6).

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/test/health-route.test.ts
import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/health/route";

describe("health route", () => {
  it("reports ok with dependency statuses", async () => {
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.deps)).toBe(true);
    const ids = body.deps.map((d: { id: string }) => d.id);
    expect(ids).toContain("ffmpeg");
    expect(ids).toContain("ytdlp");
    expect(ids).toContain("libreoffice");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/web run test -- health-route`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the route**

```ts
// packages/web/app/api/health/route.ts
import { NextResponse } from "next/server";
import { dependencyStatuses } from "@/lib/deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const deps = await dependencyStatuses();
  return NextResponse.json({
    ok: true,
    deps: deps.map((d) => ({ id: d.id, ready: d.ready, version: d.version })),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @event-editor/web run test -- health-route`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/app/api/health/route.ts packages/web/test/health-route.test.ts
git commit -m "feat(server): health endpoint with dependency statuses"
```

---

### Task 2: Dockerfile, compose, server runbook

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `docker-entrypoint.sh`, `.env.server.example`, `docs/setup/server.md`
- Modify: `.gitignore` (add `.env.server`)

**Interfaces:**
- Consumes: `GET /api/health` (Task 1).
- Produces: `docker compose up -d` serves Bento on `127.0.0.1:3000` with `/data` volume; cloudflared sidecar publishes it. Task 3 smokes against this.

Key facts (verified in code, do not re-derive):
- `next.config.ts` has `output: "standalone"` + `outputFileTracingRoot` = repo root, so the standalone server lands at `.next/standalone/packages/web/server.js`.
- ffmpeg/ffprobe come from `ffmpeg-static`/`ffprobe-static` npm packages (linux-arm64 builds exist); they are in `serverExternalPackages` so standalone tracing includes the binaries.
- LibreOffice: `sofficeCandidates` already checks `/usr/bin/soffice` on linux (`lib/pptx-convert.ts:20`).
- yt-dlp: `ytDlpCandidates` honours `EE_YTDLP_PATH` first (`lib/convert.ts:29`). Bake the universal binary (needs python3) and set that env.
- Migrations: check `packages/web/lib/db.ts` — if `getDb()` does NOT auto-migrate, the entrypoint must run core's compiled migrate before starting (path inside standalone output: `node_modules/@event-editor/core/dist/migrate.js`; verify the actual traced path with `find .next/standalone -name migrate.js` and adjust).

- [ ] **Step 1: Write `.dockerignore`**

```
node_modules
packages/*/node_modules
packages/web/.next
packages/desktop
data
docs
*.md
.env*
```

- [ ] **Step 2: Write `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/web/package.json packages/web/
RUN npm ci
COPY packages/core packages/core
COPY packages/web packages/web
RUN npm -w @event-editor/core run build && npm -w @event-editor/web run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-impress fonts-dejavu fonts-noto-cjk \
      python3 ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL -o /usr/local/bin/yt-dlp \
      https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp && yt-dlp --version
WORKDIR /app
COPY --from=build /app/packages/web/.next/standalone ./
COPY --from=build /app/packages/web/.next/static ./packages/web/.next/static
COPY --from=build /app/packages/web/public ./packages/web/public
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 \
    EE_DATA_DIR=/data EE_DB_PATH=/data/app.db EE_THUMBS_DIR=/data/thumbs \
    EE_BIN_DIR=/data/bin EE_YTDLP_PATH=/usr/local/bin/yt-dlp
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD curl -fsS http://localhost:3000/api/health || exit 1
CMD ["/docker-entrypoint.sh"]
```

- [ ] **Step 3: Write `docker-entrypoint.sh`**

```bash
#!/bin/sh
set -e
mkdir -p /data/thumbs /data/bin
MIGRATE="$(find /app -path '*/@event-editor/core/dist/migrate.js' | head -1)"
if [ -n "$MIGRATE" ]; then node "$MIGRATE"; fi
exec node /app/packages/web/server.js
```

If `getDb()` turns out to auto-migrate (check `packages/web/lib/db.ts` first), keep the migrate call anyway — it is idempotent and covers first boot.

- [ ] **Step 4: Write `docker-compose.yml` and `.env.server.example`**

```yaml
services:
  bento:
    build: .
    restart: unless-stopped
    env_file: .env.server
    volumes:
      - bento-data:/data
    ports:
      - "127.0.0.1:3000:3000"
  tunnel:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run --token ${CLOUDFLARE_TUNNEL_TOKEN}
    env_file: .env.server
    depends_on:
      - bento
volumes:
  bento-data: {}
```

```bash
# .env.server.example — copy to .env.server on the server, fill real values. Never commit .env.server.
EE_AUTH_PASSCODE=change-me
EE_AUTH_SECRET=generate-with-openssl-rand-hex-32
CLOUDFLARE_TUNNEL_TOKEN=from-cloudflare-zero-trust-dashboard
# Optional: API keys the AI tools need (same names as root .env)
# ANTHROPIC_API_KEY=
# GROQ_API_KEY=
```

Add `.env.server` to `.gitignore`.

- [ ] **Step 5: Build and boot locally**

Run:
```bash
cd ~/event-editor
docker build -t bento:local .
printf 'EE_AUTH_SECRET=%s\n' "$(openssl rand -hex 32)" > /tmp/bento-test.env
docker run -d --name bento-test --env-file /tmp/bento-test.env -p 3000:3000 bento:local
sleep 15 && curl -s http://localhost:3000/api/health
```
Expected: JSON with `"ok":true` and `ffmpeg`, `ytdlp`, `libreoffice` all `"ready":true`. (No passcode in the env file → auth off, matching today's behaviour.) Clean up: `docker rm -f bento-test`.

If any dep is not ready, fix the image (paths above) before proceeding — this is the arm64 gate the spec requires.

- [ ] **Step 6: Write `docs/setup/server.md`**

Runbook covering, in order: (1) Oracle Cloud Always Free signup + Ampere A1 instance (Ubuntu 24.04 arm64, open no inbound ports), (2) install Docker + compose plugin, (3) `git clone` repo, `cp .env.server.example .env.server`, fill passcode/secret/token, (4) Cloudflare Zero Trust → create tunnel → public hostname → `http://bento:3000`, copy token, (5) `docker compose up -d --build`, (6) verify `curl https://<host>/api/health`, (7) update procedure (`git pull && docker compose up -d --build`), (8) fallback section: identical compose on an always-on Mac (Docker Desktop). Model the tone/structure on `~/nexus/docs/setup/mobile.md`.

- [ ] **Step 7: Commit**

```bash
git add Dockerfile .dockerignore docker-compose.yml docker-entrypoint.sh .env.server.example docs/setup/server.md .gitignore
git commit -m "feat(server): Docker image with LibreOffice + yt-dlp, compose + tunnel, runbook"
```

---

### Task 3: Container smoke script (real-file round trips)

**Files:**
- Create: `scripts/server-smoke.mjs`

**Interfaces:**
- Consumes: a running container on `http://localhost:3000` (Task 2), `/api/health`.
- Produces: `node scripts/server-smoke.mjs [baseUrl]` exits 0 with a pass/fail table; used again after deploy against the public URL.

Runs on the HOST (repo checkout has `ffmpeg-static` and `jszip` in `packages/web/node_modules` — import them from the script for fixture generation).

- [ ] **Step 1: Write the script**

```js
// scripts/server-smoke.mjs — real-file round trips against a running Bento server.
// Usage: node scripts/server-smoke.mjs [baseUrl]   (default http://localhost:3000)
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ffmpeg = require("../packages/web/node_modules/ffmpeg-static");
const JSZip = require("../packages/web/node_modules/jszip");

const BASE = process.argv[2] ?? "http://localhost:3000";
const dir = mkdtempSync(join(tmpdir(), "bento-smoke-"));
const results = [];

function fixtureVideo() {
  const p = join(dir, "in.mp4");
  execFileSync(ffmpeg, ["-y", "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=10",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-shortest", p], { stdio: "ignore" });
  return p;
}
function fixturePng() {
  const p = join(dir, "in.png");
  execFileSync(ffmpeg, ["-y", "-f", "lavfi", "-i", "testsrc=duration=0.1:size=640x480:rate=1",
    "-frames:v", "1", p], { stdio: "ignore" });
  return p;
}
async function fixturePptx() {
  // Minimal single-slide pptx via jszip (content types + rels + one slide).
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`);
  // NOTE: executor — complete the remaining four parts (presentation.xml, its rels,
  // slideMaster1/slideLayout1 + rels, slide1.xml) with the minimal OOXML skeleton;
  // validate by opening the produced file with LibreOffice locally once:
  //   soffice --headless --convert-to pdf <file>
  const p = join(dir, "in.pptx");
  writeFileSync(p, await zip.generateAsync({ type: "nodebuffer" }));
  return p;
}

async function post(label, path, field, filePath, extra = {}) {
  try {
    const form = new FormData();
    form.set(field, new Blob([readFileSync(filePath)]), filePath.split("/").pop());
    for (const [k, v] of Object.entries(extra)) form.set(k, v);
    const res = await fetch(`${BASE}${path}`, { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));
    results.push({ label, pass: res.ok, detail: res.ok ? "" : `${res.status} ${body.error ?? ""}` });
    return res.ok ? body : null;
  } catch (err) {
    results.push({ label, pass: false, detail: String(err) });
    return null;
  }
}
async function pollJob(label, path, done) {
  for (let i = 0; i < 60; i++) {
    const res = await fetch(`${BASE}${path}`);
    const body = await res.json().catch(() => ({}));
    if (done(body)) { results.push({ label, pass: true, detail: "" }); return; }
    if (body.status === "failed" || body.error) { results.push({ label, pass: false, detail: JSON.stringify(body).slice(0, 200) }); return; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  results.push({ label, pass: false, detail: "timed out after 120s" });
}

// 1. health + binaries
const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
for (const d of health.deps) results.push({ label: `dep:${d.id}`, pass: d.ready, detail: d.version ?? "" });

// 2. convert (file → mp3)
const conv = await post("convert:upload", "/api/convert/file", "file", fixtureVideo());
if (conv?.id) await pollJob("convert:job", `/api/convert/${conv.id}`, (b) => b.status === "done" || b.ready === true);

// 3. resize
await post("resize", "/api/resize", "file", fixturePng(), { width: "320" });

// 4. pdf merge (two copies of a pdf made from the png via the pdf tool is overkill;
//    POST the png to /api/pdf/process/compress only if it accepts images — otherwise
//    executor: read app/api/pdf/process/[mode]/route.ts and use its simplest mode with
//    a pdf-lib-generated one-page fixture instead.)

// 5. video (transcode)
const vid = await post("video:upload", "/api/video", "file", fixtureVideo(), { preset: "medium" });
if (vid?.id) await pollJob("video:job", `/api/video/${vid.id}`, (b) => b.status === "done");

// 6. splice (single-clip join)
const spl = await post("splice:upload", "/api/splice", "file", fixtureVideo());
if (spl?.id) await pollJob("splice:job", `/api/splice/${spl.id}`, (b) => b.status === "done");

// 7. slice (pptx → pdf via LibreOffice)
const pptx = await fixturePptx();
await post("slice:convert", "/api/slice/convert", "file", pptx);

// report
const w = Math.max(...results.map((r) => r.label.length));
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.label.padEnd(w)}  ${r.detail}`);
process.exit(results.every((r) => r.pass) ? 0 : 1);
```

**Executor note (not a placeholder — a required verification):** the exact request field names, extra params, and job-status shapes above are best-effort; before running, read each target route (`app/api/convert/file/route.ts`, `app/api/resize/route.ts`, `app/api/video/route.ts`, `app/api/splice/route.ts`, `app/api/slice/convert/route.ts`, `app/api/pdf/process/[mode]/route.ts`) and correct field names/status predicates to match the real contracts. AI-key-dependent tools (transcribe, sorter, studio) are exercised only via `dep` checks — they need real API keys and Google OAuth, out of smoke scope.

- [ ] **Step 2: Run against the local container**

Run:
```bash
docker run -d --name bento-smoke --env-file /tmp/bento-test.env -p 3000:3000 bento:local
sleep 15 && node scripts/server-smoke.mjs; docker rm -f bento-smoke
```
Expected: all PASS lines, exit 0. Any FAIL on `dep:*` or ffmpeg/LibreOffice round trips must be fixed in the image before the plan proceeds — this is the gate.

- [ ] **Step 3: Commit**

```bash
git add scripts/server-smoke.mjs
git commit -m "test(server): real-file smoke script gating the container image"
```

---

### Task 4: Auth token library

**Files:**
- Create: `packages/web/lib/auth.ts`
- Test: `packages/web/test/auth.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 5 and 6):
  - `makeToken(secret: string, expiresAtMs: number): Promise<string>`
  - `verifyToken(secret: string, token: string | undefined, nowMs: number): Promise<boolean>`
  - `authEnabled(env?: NodeJS.ProcessEnv): boolean`
  - `AUTH_COOKIE = "ee_auth"`, `AUTH_MAX_AGE_S = 90 * 24 * 3600`

Uses only Web Crypto (`globalThis.crypto.subtle`) so the same module runs in middleware and node routes.

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/test/auth.test.ts
import { describe, it, expect } from "vitest";
import { makeToken, verifyToken, authEnabled } from "@/lib/auth";

const SECRET = "test-secret";

describe("auth tokens", () => {
  it("round-trips a valid token", async () => {
    const t = await makeToken(SECRET, Date.now() + 60_000);
    expect(await verifyToken(SECRET, t, Date.now())).toBe(true);
  });
  it("rejects expired tokens", async () => {
    const t = await makeToken(SECRET, Date.now() - 1);
    expect(await verifyToken(SECRET, t, Date.now())).toBe(false);
  });
  it("rejects tampered payloads and wrong secrets", async () => {
    const t = await makeToken(SECRET, Date.now() + 60_000);
    const [exp, sig] = t.split(".");
    expect(await verifyToken(SECRET, `${Number(exp) + 9999}.${sig}`, Date.now())).toBe(false);
    expect(await verifyToken("other", t, Date.now())).toBe(false);
  });
  it("rejects missing/malformed tokens", async () => {
    expect(await verifyToken(SECRET, undefined, Date.now())).toBe(false);
    expect(await verifyToken(SECRET, "garbage", Date.now())).toBe(false);
  });
  it("authEnabled requires passcode+secret and honours the kill switch", () => {
    expect(authEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(authEnabled({ EE_AUTH_PASSCODE: "1", EE_AUTH_SECRET: "s" } as NodeJS.ProcessEnv)).toBe(true);
    expect(authEnabled({ EE_AUTH_PASSCODE: "1" } as NodeJS.ProcessEnv)).toBe(false);
    expect(authEnabled({ EE_AUTH_PASSCODE: "1", EE_AUTH_SECRET: "s", EE_AUTH_DISABLED: "1" } as NodeJS.ProcessEnv)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/web run test -- auth`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// packages/web/lib/auth.ts — shared by middleware (edge-safe) and node routes.
export const AUTH_COOKIE = "ee_auth";
export const AUTH_MAX_AGE_S = 90 * 24 * 3600;

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function makeToken(secret: string, expiresAtMs: number): Promise<string> {
  const payload = String(expiresAtMs);
  return `${payload}.${await hmacHex(secret, payload)}`;
}

export async function verifyToken(secret: string, token: string | undefined, nowMs: number): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const given = token.slice(dot + 1);
  const expected = await hmacHex(secret, payload);
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  const exp = Number(payload);
  return diff === 0 && Number.isFinite(exp) && exp > nowMs;
}

export function authEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.EE_AUTH_PASSCODE && !!env.EE_AUTH_SECRET && env.EE_AUTH_DISABLED !== "1";
}
```

- [ ] **Step 4: Run tests**

Run: `npm -w @event-editor/web run test -- auth`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/auth.ts packages/web/test/auth.test.ts
git commit -m "feat(auth): HMAC cookie token library (Web Crypto, edge-safe)"
```

---

### Task 5: Login route + login page

**Files:**
- Create: `packages/web/app/api/auth/login/route.ts`, `packages/web/app/login/page.tsx`, `packages/web/app/login/LoginClient.tsx`
- Test: `packages/web/test/login-route.test.ts`

**Interfaces:**
- Consumes: `makeToken`, `AUTH_COOKIE`, `AUTH_MAX_AGE_S` from `@/lib/auth` (Task 4).
- Produces: `POST /api/auth/login` `{code: string}` → 200 + `ee_auth` cookie, 401 on wrong code, 429 after 10 misses/10 min/IP, 500 if unconfigured. `/login?next=/path` page. Consumed by Task 6's middleware redirects.

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/test/login-route.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { POST, _resetAttempts } from "@/app/api/auth/login/route";

function req(body: unknown, ip = "1.2.3.4") {
  return new Request("http://x/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

describe("login route", () => {
  beforeEach(() => {
    process.env.EE_AUTH_PASSCODE = "6767";
    process.env.EE_AUTH_SECRET = "test-secret";
    _resetAttempts();
  });
  afterEach(() => {
    delete process.env.EE_AUTH_PASSCODE;
    delete process.env.EE_AUTH_SECRET;
  });

  it("sets the auth cookie on the right code", async () => {
    const res = await POST(req({ code: "6767" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("ee_auth=");
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
  });
  it("401s on a wrong code, no cookie", async () => {
    const res = await POST(req({ code: "0000" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
  it("429s after 10 failures from one IP", async () => {
    for (let i = 0; i < 10; i++) await POST(req({ code: "bad" }, "9.9.9.9"));
    const res = await POST(req({ code: "6767" }, "9.9.9.9"));
    expect(res.status).toBe(429);
  });
  it("500s when auth is not configured", async () => {
    delete process.env.EE_AUTH_PASSCODE;
    const res = await POST(req({ code: "6767" }));
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/web run test -- login-route`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the route**

```ts
// packages/web/app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import { makeToken, AUTH_COOKIE, AUTH_MAX_AGE_S } from "@/lib/auth";

export const runtime = "nodejs";

const WINDOW_MS = 10 * 60_000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, { n: number; resetAt: number }>();

/** Test hook: clear the in-memory rate limiter. */
export function _resetAttempts(): void {
  attempts.clear();
}

export async function POST(request: Request) {
  const passcode = process.env.EE_AUTH_PASSCODE;
  const secret = process.env.EE_AUTH_SECRET;
  if (!passcode || !secret) {
    return NextResponse.json({ error: "Auth is not configured on this server" }, { status: 500 });
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const a = attempts.get(ip);
  if (a && a.resetAt > now && a.n >= MAX_ATTEMPTS) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }
  const body = await request.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code : "";
  if (code !== passcode) {
    const cur = a && a.resetAt > now ? a : { n: 0, resetAt: now + WINDOW_MS };
    attempts.set(ip, { n: cur.n + 1, resetAt: cur.resetAt });
    return NextResponse.json({ error: "Wrong passcode" }, { status: 401 });
  }
  attempts.delete(ip);
  const token = await makeToken(secret, now + AUTH_MAX_AGE_S * 1000);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: AUTH_MAX_AGE_S,
  });
  return res;
}
```

- [ ] **Step 4: Run tests**

Run: `npm -w @event-editor/web run test -- login-route`
Expected: PASS (4 tests).

- [ ] **Step 5: Build the login page**

```tsx
// packages/web/app/login/page.tsx
import { LoginClient } from "./LoginClient";

export const metadata = { title: "Sign in — Bento" };

export default function LoginPage() {
  return <LoginClient />;
}
```

```tsx
// packages/web/app/login/LoginClient.tsx
"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function LoginClient() {
  const router = useRouter();
  const params = useSearchParams();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      const next = params.get("next");
      router.replace(next && next.startsWith("/") ? next : "/");
      router.refresh();
      return;
    }
    const body = await res?.json().catch(() => null);
    setError(body?.error ?? "Could not sign in. Check the connection.");
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <form onSubmit={submit} className="w-full max-w-xs rounded-card bg-surface p-6 shadow-soft">
        <div className="text-xs text-muted">Spark team</div>
        <h1 className="mt-1 text-lg font-semibold text-ink">Sign in to Bento</h1>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Passcode"
          aria-label="Passcode"
          className="mt-4 w-full min-h-[48px] rounded-lg border border-line bg-canvas px-3 text-ink outline-none focus:border-accent"
        />
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        <button
          type="submit"
          disabled={busy || code.length === 0}
          className="mt-4 w-full min-h-[48px] rounded-lg bg-ink px-6 py-3 text-sm font-medium text-white shadow-raisededge disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
```

Note: `useSearchParams` requires the page to render inside a Suspense boundary in Next 16 — if `npm run build` complains, wrap `<LoginClient />` in `<Suspense>` in `page.tsx`.

- [ ] **Step 6: Verify build + visual**

Run: `npm run build` — expected: clean.
Then `npm run dev`, open `http://localhost:3000/login` in the Playwright MCP at 390×844: card centred, input and button ≥48px tall, wrong code shows "Wrong passcode" in danger red.

- [ ] **Step 7: Commit**

```bash
git add packages/web/app/api/auth/login packages/web/app/login packages/web/test/login-route.test.ts
git commit -m "feat(auth): login route with rate limiting + login page"
```

---

### Task 6: Middleware — auth gate + upload caps

**Files:**
- Create: `packages/web/middleware.ts`, `packages/web/lib/limits.ts`
- Test: `packages/web/test/limits.test.ts`

**Interfaces:**
- Consumes: `verifyToken`, `authEnabled`, `AUTH_COOKIE` (Task 4).
- Produces: every page/API guarded when auth is on; `capForPath(pathname: string): number | null` exported from `@/lib/limits`; oversized POSTs get 413 with a JSON error whether or not auth is on.

- [ ] **Step 1: Write the failing limits test**

```ts
// packages/web/test/limits.test.ts
import { describe, it, expect } from "vitest";
import { capForPath, GB, MB } from "@/lib/limits";

describe("upload caps", () => {
  it("gives video-class routes 2GB", () => {
    expect(capForPath("/api/video")).toBe(2 * GB);
    expect(capForPath("/api/splice")).toBe(2 * GB);
  });
  it("gives audio-class routes 500MB", () => {
    expect(capForPath("/api/convert/file")).toBe(500 * MB);
    expect(capForPath("/api/transcribe")).toBe(500 * MB);
  });
  it("gives everything else under /api 100MB", () => {
    expect(capForPath("/api/resize")).toBe(100 * MB);
    expect(capForPath("/api/pdf/process/merge")).toBe(100 * MB);
  });
  it("does not cap non-API paths or auth", () => {
    expect(capForPath("/video")).toBeNull();
    expect(capForPath("/api/auth/login")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/web run test -- limits`
Expected: FAIL.

- [ ] **Step 3: Implement limits + middleware**

```ts
// packages/web/lib/limits.ts
export const MB = 1_000_000;
export const GB = 1_000_000_000;

const CLASSES: Array<{ prefixes: string[]; cap: number }> = [
  { prefixes: ["/api/video", "/api/splice"], cap: 2 * GB },
  { prefixes: ["/api/convert", "/api/transcribe"], cap: 500 * MB },
];

export function capForPath(pathname: string): number | null {
  if (!pathname.startsWith("/api/") || pathname.startsWith("/api/auth/")) return null;
  for (const c of CLASSES) if (c.prefixes.some((p) => pathname.startsWith(p))) return c.cap;
  return 100 * MB;
}
```

```ts
// packages/web/middleware.ts
import { NextResponse, type NextRequest } from "next/server";
import { verifyToken, authEnabled, AUTH_COOKIE } from "@/lib/auth";
import { capForPath, MB } from "@/lib/limits";

const PUBLIC = new Set(["/login", "/api/auth/login", "/api/health"]);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const cap = capForPath(pathname);
  if (cap !== null && (req.method === "POST" || req.method === "PUT")) {
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > cap) {
      return NextResponse.json(
        { error: `File too large. The limit here is ${Math.round(cap / MB)} MB.` },
        { status: 413 },
      );
    }
  }

  if (!authEnabled() || PUBLIC.has(pathname)) return NextResponse.next();

  const ok = await verifyToken(
    process.env.EE_AUTH_SECRET!,
    req.cookies.get(AUTH_COOKIE)?.value,
    Date.now(),
  );
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next internals and static assets (public/ files have extensions).
  matcher: ["/((?!_next/|mediapipe/|.*\\.(?:svg|png|ico|js|wasm|tflite|css|map)$).*)"],
};
```

- [ ] **Step 4: Run tests**

Run: `npm -w @event-editor/web run test -- limits` → PASS.
Run full suite: `npm -w @event-editor/web run test` → all green (no regressions).

- [ ] **Step 5: Verify the gate end-to-end**

Run:
```bash
EE_AUTH_PASSCODE=6767 EE_AUTH_SECRET=$(openssl rand -hex 32) npm run dev
```
Check with curl:
- `curl -sI localhost:3000/` → 307 to `/login?next=%2F`
- `curl -s localhost:3000/api/resize -X POST` → `{"error":"Unauthorized"}` 401
- `curl -s localhost:3000/api/health` → 200
- `curl -s localhost:3000/api/resize -X POST -H 'content-length: 200000000'` → 413
- Login via the page, then `/` loads.
Then restart with NO auth env: `npm run dev` → `/` loads directly (desktop parity).

- [ ] **Step 6: Commit**

```bash
git add packages/web/middleware.ts packages/web/lib/limits.ts packages/web/test/limits.test.ts
git commit -m "feat(auth): middleware gate + per-class upload caps"
```

---

### Task 7: Mobile shell pass (layout, Nav, grid, tokens)

**Files:**
- Modify: `packages/web/app/layout.tsx`, `packages/web/app/globals.css`, `packages/web/components/Nav.tsx`, `packages/web/components/ToolGrid.tsx`, `packages/web/components/ToolCard.tsx` (read first; touch only what the checklist needs)

**Interfaces:**
- Produces: the shell (home grid, topbar pills, search) is fully usable at 390×844. Tool batch tasks (8–10) assume this shell.

- [ ] **Step 1: Viewport + safe areas in `layout.tsx`**

Add below `metadata`:

```tsx
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
  themeColor: "#f5f6f8",
};
```

Change the `<main>` line to:

```tsx
<main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">{children}</main>
```

- [ ] **Step 2: Safe-area + mobile type in `globals.css`**

Append:

```css
/* Mobile: bigger rem-based type and iOS safe areas. Tailwind's rem sizes
   (text-sm etc) scale with this; the 13px `text-base` token stays desktop-only. */
@media (max-width: 640px) {
  :root { font-size: 17px; }
  body {
    padding-left: env(safe-area-inset-left);
    padding-right: env(safe-area-inset-right);
    padding-bottom: env(safe-area-inset-bottom);
  }
  header { padding-top: env(safe-area-inset-top); }
}
```

- [ ] **Step 3: Nav touch targets**

In `Nav.tsx`, on the pill `<button>` className change `px-3 py-2` → `min-h-[44px] px-3 py-2` and confirm the pill row keeps `overflow-x-auto` (it does today — don't remove it). Add `overscroll-x-contain` to the `<nav>` so edge swipes don't bounce the page.

- [ ] **Step 4: Grid + cards at 390px**

Read `ToolGrid.tsx`/`ToolCard.tsx`. Ensure: grid is single column below `sm` (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` or the existing equivalent), card tap area is the whole card, favourite/group popover buttons are ≥44px, search input ≥48px tall on mobile.

- [ ] **Step 5: Verify at 390×844**

`npm run dev` (no auth env), Playwright MCP at 390×844 on `/`: no horizontal page scroll, pills scroll horizontally, cards stack one per row, search usable, settings icon tappable. Screenshot for the reviewer.

- [ ] **Step 6: Run tests, commit**

Run: `npm -w @event-editor/web run test` → green (tool-store/search tests unaffected).

```bash
git add packages/web/app/layout.tsx packages/web/app/globals.css packages/web/components
git commit -m "feat(mobile): shell responsive pass — viewport, safe areas, 17px base, touch targets"
```

---

### Task 8: Mobile client utilities — upload progress + visible polling

**Files:**
- Create: `packages/web/lib/upload.ts`, `packages/web/lib/use-visible-poll.ts`
- Test: `packages/web/test/upload.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 9–10):
  - `uploadWithProgress(url: string, form: FormData, onProgress: (frac: number) => void): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>`
  - `usePollWhileVisible(fn: () => void, ms: number, active: boolean): void` — ticks on the interval only while the document is visible, and fires immediately on `visibilitychange` back to visible.

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/test/upload.test.ts
import { describe, it, expect, vi } from "vitest";
import { uploadWithProgress } from "@/lib/upload";

class FakeXHR {
  static last: FakeXHR;
  upload = { onprogress: null as null | ((e: ProgressEvent) => void) };
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  status = 200;
  responseText = '{"id":"x"}';
  open = vi.fn();
  send = vi.fn(() => {
    this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 } as ProgressEvent);
    this.onload?.();
  });
  constructor() { FakeXHR.last = this; }
}

describe("uploadWithProgress", () => {
  it("reports progress and resolves with parsed json", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    const fracs: number[] = [];
    const res = await uploadWithProgress("/api/x", new FormData(), (f) => fracs.push(f));
    expect(fracs).toEqual([0.5]);
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ id: "x" });
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/web run test -- upload`
Expected: FAIL.

- [ ] **Step 3: Implement both modules**

```ts
// packages/web/lib/upload.ts
export type UploadResponse = { ok: boolean; status: number; json: () => Promise<unknown> };

export function uploadWithProgress(
  url: string,
  form: FormData,
  onProgress: (frac: number) => void,
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        json: async () => JSON.parse(xhr.responseText),
      });
    xhr.onerror = () => reject(new Error("Upload failed. Check the connection."));
    xhr.send(form);
  });
}
```

```ts
// packages/web/lib/use-visible-poll.ts
"use client";
import { useEffect } from "react";

/** Poll `fn` every `ms` while the tab is visible; fire immediately when it
 *  becomes visible again (phone unlock, app switch back). */
export function usePollWhileVisible(fn: () => void, ms: number, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    fn();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") fn();
    }, ms);
    const onVis = () => {
      if (document.visibilityState === "visible") fn();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [fn, ms, active]);
}
```

- [ ] **Step 4: Run tests**

Run: `npm -w @event-editor/web run test -- upload` → PASS. Full suite green.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/upload.ts packages/web/lib/use-visible-poll.ts packages/web/test/upload.test.ts
git commit -m "feat(mobile): upload progress helper + visibility-aware polling hook"
```

---

### Tasks 9–10: Per-tool mobile pass (two batches)

**Task 9 files (media batch):** `app/convert/ConvertClient.tsx`, `app/transcribe/TranscribeClient.tsx` (+ `PastTranscriptions.tsx`, `EventDetailsPanel.tsx`), `app/slice/SliceClient.tsx` (+ `PastSlices.tsx`), `app/video/*Client.tsx`, `app/splice/SpliceClient.tsx`.

**Task 10 files (images + documents batch):** `app/sorter/*`, `app/studio/*` (incl. `studio/batch/StudioBatchClient.tsx`), `app/heic/HeicClient.tsx`, `app/resize/ResizeClient.tsx`, `app/cutout/*`, `app/pdf/PdfClient.tsx`, `app/qr/QrClient.tsx`, `app/badge/BadgeClient.tsx`, `app/certificate/*`, `app/place-card/*`, `app/ticket/TicketClient.tsx`, `app/settings/*`, `components/FileDrop.tsx`, `components/MergeToolClient.tsx`.

**Interfaces:**
- Consumes: `uploadWithProgress` and `usePollWhileVisible` from Task 8; shell from Task 7.
- Produces: every tool passes the mobile checklist below at 390×844.

Both tasks apply the same checklist to each tool file (read the file first; make the minimal edits that satisfy each item — this is a defined transformation, applied per file):

1. **Layout:** no horizontal page scroll at 390px. Multi-column panels stack (`grid-cols-1 sm:grid-cols-2` / `flex-col sm:flex-row`). Wide tables/lists get their own `overflow-x-auto` wrapper.
2. **Touch:** every button/select/input ≥44px tall on mobile (add `min-h-[44px]` where the current `py-*` falls short). Primary action buttons full-width on mobile (`w-full sm:w-auto`).
3. **File inputs:** set the `accept` attribute per media class — video tools `accept="video/*"`, audio/convert `accept="audio/*,video/*"`, image tools `accept="image/*"` (heic additionally `,.heic,.HEIC`), pdf `accept="application/pdf"`, slice `accept=".pptx,.pdf"`, splice matches its type-locked mode. `FileDrop.tsx` must pass `accept` through to its `<input>` if it doesn't already.
4. **Upload progress:** any upload path that can exceed ~10 MB (convert, transcribe, video, splice, slice, pdf, studio batch) switches its `fetch(url, {body: form})` call to `uploadWithProgress(url, form, setProgress)` and renders a determinate progress bar (accent fill on `line` track, `h-1.5 rounded-full`) while `progress < 1`. Keep the existing post-upload "processing" state as is.
5. **Polling:** components that poll job status with `setInterval` (known: `studio/batch/StudioBatchClient.tsx`; grep each batch for `setInterval`) switch to `usePollWhileVisible` with the same interval.
6. **Failure states:** confirm a failed job/action renders a visible error (danger text or toast), not a stuck spinner. Fix any that don't.
7. **413/401 handling:** where the tool POSTs, surface `res.status === 413` with the server's message, and on 401 `window.location.assign("/login")`.

Per task, steps are:

- [ ] **Step 1:** Read every file in the batch; apply the checklist per tool, committing per tool (`feat(mobile): <tool> 390px pass`).
- [ ] **Step 2:** After each tool: `npm -w @event-editor/web run test` green, then Playwright MCP at 390×844 — walk the tool's happy path with a small real file where feasible; screenshot.
- [ ] **Step 3:** Batch-final: `npm run build` clean; one screenshot per tool attached to the review.

(Cutout note from memory: MediaPipe wasm runs client-side — at 390px verify the model download UX and that output stays full input resolution. No server work.)

---

### Task 11: Capacitor iOS shell

**Files:**
- Create: `packages/mobile/package.json`, `packages/mobile/capacitor.config.ts`, `packages/mobile/www/error.html`, `packages/mobile/.gitignore`, `docs/setup/mobile.md`

**Interfaces:**
- Consumes: the deployed HTTPS URL (Task 2's runbook output). Until it exists, use a placeholder and document swapping it.
- Produces: `npx cap add ios && npx cap sync ios` yields an Xcode project that wraps the hosted app. Native `ios/` dir stays untracked (matches the Nexus approach).

- [ ] **Step 1: Scaffold**

```json
// packages/mobile/package.json
{
  "name": "@event-editor/mobile",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "sync": "cap sync ios",
    "open": "cap open ios"
  },
  "dependencies": {
    "@capacitor/core": "^7.0.0",
    "@capacitor/ios": "^7.0.0",
    "@capacitor/status-bar": "^7.0.0"
  },
  "devDependencies": {
    "@capacitor/cli": "^7.0.0"
  }
}
```

```ts
// packages/mobile/capacitor.config.ts
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.spark.bento",
  appName: "Bento",
  webDir: "www",
  server: {
    // Set to the real tunnel hostname from docs/setup/server.md before building.
    url: "https://bento.example.com",
    // Without errorPath the offline page is bundled but unreachable (Nexus lesson).
    errorPath: "error.html",
  },
};

export default config;
```

```gitignore
# packages/mobile/.gitignore
ios/
node_modules/
```

- [ ] **Step 2: Offline card `www/error.html`**

Self-contained HTML (inline CSS, no external requests): Bento glyph (copy the inline SVG from `components/Nav.tsx`), "You're offline" heading, "Bento needs a connection to reach the Spark server." body, a retry button (`onclick="location.replace('/')"`), DM Sans stack with system fallback, canvas `#f5f6f8` background, dark-mode via `prefers-color-scheme`. Match the anti-vibecode look of the app shell.

- [ ] **Step 3: Verify what CI/no-Xcode allows**

Run: `cd packages/mobile && npm install && npx cap sync ios || true` — on a machine without Xcode/CocoaPods this may stop at pod install; that's acceptable. The must-pass check: `npx tsc --noEmit capacitor.config.ts` clean and `www/error.html` renders correctly in a browser at 390×844 (Playwright MCP screenshot, light + dark).

- [ ] **Step 4: Write `docs/setup/mobile.md`**

iOS runbook, modelled byte-for-byte on the structure of `~/nexus/docs/setup/mobile.md`: prerequisites (Xcode, CocoaPods), set the real `server.url`, `npm install && npx cap add ios && npx cap sync ios && npx cap open ios`, set the signing team (free personal team = 7-day profile; $99 account for TestFlight), run on device, StatusBar gotcha note (UPPERCASE style tokens), icon/splash instructions pointing at the Bento icon asset used for v0.0.9 desktop.

- [ ] **Step 5: Commit**

```bash
git add packages/mobile docs/setup/mobile.md
git commit -m "feat(mobile): Capacitor iOS shell + offline card + runbook"
```

---

### Task 12: Final verification sweep

**Files:** none new.

- [ ] **Step 1:** `npm run build` at root — clean.
- [ ] **Step 2:** `npm -w @event-editor/web run test` and `npm -w @event-editor/core run test` — all green.
- [ ] **Step 3:** Rebuild the Docker image, boot with auth env (`EE_AUTH_PASSCODE=6767`, generated secret), run `node scripts/server-smoke.mjs` — note: smoke now needs a cookie; add `--passcode` flag support to the script (login first, reuse the `set-cookie` on subsequent requests) as part of this step.
- [ ] **Step 4:** Full 390×844 walk in Playwright MCP against the authed container: login → home → one media tool round trip → one image tool round trip. Screenshots.
- [ ] **Step 5:** Desktop parity: `npm run dev` with no auth env → no login, tools unchanged.
- [ ] **Step 6:** Commit any fixes; push. Summarise Caleb's remaining personal steps (Oracle account, tunnel token, real `server.url`, Xcode signing, TestFlight decision).
