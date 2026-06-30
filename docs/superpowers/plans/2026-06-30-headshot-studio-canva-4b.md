# Headshot Studio — Canva Renderer (Plan 4b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Canva brand-template renderer to Headshot Studio — pick a photo + name/title, autofill a Canva brand template, export a PNG — selectable via a Local|Canva toggle on `/studio`.

**Architecture:** Mirror the existing renderer's dependency-injection shape: a pure-ish orchestrator in `@event-editor/core` drives DB status transitions; `packages/web` supplies the concrete Canva/Drive/filesystem deps. Canva Connect auth is a raw-`fetch` PKCE flow (Google's `googleapis` client doesn't cover it). Three async Canva jobs (asset upload, autofill, export) each create→poll. Output is unified with the local path (`data/headshots/<id>.png`) so preview/download is identical.

**Tech Stack:** Next.js 16 (App Router, `runtime = "nodejs"`), Drizzle + better-sqlite3, TypeScript, Vitest, Canva Connect REST API, Node `crypto` for PKCE.

## Global Constraints

- Canva redirect URL is **fixed** at `http://127.0.0.1:3000/api/canva/callback` — Canva rejects `localhost`. Never emit `localhost` for Canva.
- Third-party creds use **no `EE_` prefix**: `CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET` (matches `GOOGLE_*`, `GROQ_*`). Tool-tuning vars keep `EE_`.
- Web imports core via **subpath exports only** (`@event-editor/core/headshot`, `/schema`, `/tokens`, `/db`), never the barrel (barrel pulls native better-sqlite3).
- Relative **value** imports are **extensionless** (`./pkce`, not `./pkce.js`) — Turbopack does not remap `.js`→`.ts` on resolved value imports. `import type ... from "./x"` is also fine.
- UI follows the anti-vibecode house standards already in use (one accent, neutral rest, sentence-case eyebrows, no em dashes).
- No DB migration — the `headshots` table already has `renderer`, `canva_template_id`, `template_id`, `autofill_job_id`, `design_id`, `export_url`, `output_path`, `source_drive_file_id`, and the `rendering|autofilling|exporting|done|error` status union.
- Canva path uploads the **raw full-res** Drive photo; no local `sharp` framing. The frame picker stays local-only.
- All tests mock `fetch`/deps — **no live Canva calls** in the suite.
- Run the web suite from `packages/web` (`npm -w @event-editor/web run test`); core from root or `-w @event-editor/core`.

---

## File Structure

**Create:**
- `packages/web/lib/backoff.ts` — generic retry helper (extracted from transcriber).
- `packages/web/lib/canva/pkce.ts` — PKCE verifier/challenge.
- `packages/web/lib/canva/oauth.ts` — authorize-URL builder, token exchange, refresh.
- `packages/web/lib/canva/client.ts` — typed Canva Connect wrapper (templates, asset upload, autofill, export) with token refresh + backoff.
- `packages/web/lib/canva/fields.ts` — pure `resolveTemplateFields(dataset)`.
- `packages/web/app/api/canva/auth/route.ts` — start OAuth (sets PKCE cookies, redirects).
- `packages/web/app/api/canva/callback/route.ts` — exchange code, persist token.
- `packages/web/app/api/studio/templates/route.ts` — list brand templates.
- `docs/setup/canva.md` — operator setup guide.

**Modify:**
- `packages/web/lib/transcriber.ts` — use the shared `withBackoff` (drop the private copy).
- `packages/core/src/headshot.ts` — add `createCanvaHeadshot` + `runHeadshotCanva`.
- `packages/web/lib/status.ts` — `headshotStatusView` maps `autofilling`/`exporting`.
- `packages/web/lib/studio.ts` — add `startHeadshotCanva`.
- `packages/web/app/api/studio/headshots/route.ts` — branch POST on `renderer`.
- `packages/web/app/settings/page.tsx` — Canva connect card.
- `packages/web/app/studio/StudioClient.tsx` — renderer toggle, template dropdown, canva submit, recovery.
- `.env.example`, `README.md` — new env + setup pointer.

---

## Task 1: Shared `withBackoff` helper

**Files:**
- Create: `packages/web/lib/backoff.ts`
- Modify: `packages/web/lib/transcriber.ts` (remove private `withBackoff`, import shared)
- Test: `packages/web/test/backoff.test.ts`

**Interfaces:**
- Produces: `withBackoff<T>(fn: () => Promise<T>, opts?: { tries?: number; retryOn?: (status: number | undefined) => boolean }): Promise<T>`. Default `tries = 6`, default `retryOn = (s) => s === 429 || s === 529`. Reads `err.status ?? err.statusCode` and optional `err.retryAfter` (seconds) for the delay; otherwise exponential `1000 * 2 ** i`, capped 300_000ms.

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/test/backoff.test.ts
import { describe, it, expect, vi } from "vitest";
import { withBackoff } from "../lib/backoff";

describe("withBackoff", () => {
  it("retries on 429 then succeeds", async () => {
    let n = 0;
    const fn = vi.fn(async () => {
      if (n++ === 0) throw Object.assign(new Error("rl"), { status: 429, retryAfter: 0 });
      return "ok";
    });
    expect(await withBackoff(fn, { tries: 3 })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 400", async () => {
    const fn = vi.fn(async () => { throw Object.assign(new Error("bad"), { status: 400 }); });
    await expect(withBackoff(fn, { tries: 3 })).rejects.toThrow("bad");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retryOn override catches 5xx", async () => {
    let n = 0;
    const fn = vi.fn(async () => {
      if (n++ === 0) throw Object.assign(new Error("srv"), { status: 503, retryAfter: 0 });
      return 7;
    });
    const out = await withBackoff(fn, { tries: 3, retryOn: (s) => s !== undefined && s >= 500 });
    expect(out).toBe(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/web run test -- backoff`
Expected: FAIL — `Cannot find module '../lib/backoff'`.

- [ ] **Step 3: Write the helper**

```ts
// packages/web/lib/backoff.ts
export interface BackoffOpts {
  tries?: number;
  retryOn?: (status: number | undefined) => boolean;
}

export async function withBackoff<T>(fn: () => Promise<T>, opts: BackoffOpts = {}): Promise<T> {
  const tries = opts.tries ?? 6;
  const retryOn = opts.retryOn ?? ((s) => s === 429 || s === 529);
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const status: number | undefined = err?.status ?? err?.statusCode;
      if (!retryOn(status)) throw err;
      const delayMs =
        typeof err?.retryAfter === "number" && Number.isFinite(err.retryAfter)
          ? Math.min(err.retryAfter * 1000, 300_000)
          : 1000 * 2 ** i;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}
```

- [ ] **Step 4: Point the transcriber at the shared helper**

In `packages/web/lib/transcriber.ts`: delete the local `async function withBackoff(...) {...}` block and add at the top with the other imports:

```ts
import { withBackoff } from "./backoff";
```

(The existing call sites `withBackoff(() => transcribeChunk(path))` and `withBackoff(() => summarizeTranscript(...))` keep working — default `retryOn` still covers 429/529.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm -w @event-editor/web run test -- backoff transcriber`
Expected: PASS (new backoff tests + existing transcriber tests still green).

- [ ] **Step 6: Commit**

```bash
git add packages/web/lib/backoff.ts packages/web/test/backoff.test.ts packages/web/lib/transcriber.ts
git commit -m "refactor(web): extract shared withBackoff helper"
```

---

## Task 2: PKCE helpers

**Files:**
- Create: `packages/web/lib/canva/pkce.ts`
- Test: `packages/web/test/canva-pkce.test.ts`

**Interfaces:**
- Produces: `createVerifier(): string` (43–128 char base64url), `challengeFor(verifier: string): string` (base64url of SHA-256, no padding).

- [ ] **Step 1: Write the failing test**

Uses the RFC 7636 reference vector (verifier → known S256 challenge).

```ts
// packages/web/test/canva-pkce.test.ts
import { describe, it, expect } from "vitest";
import { createVerifier, challengeFor } from "../lib/canva/pkce";

describe("pkce", () => {
  it("matches the RFC 7636 S256 vector", () => {
    const v = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(challengeFor(v)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("verifier is url-safe and long enough", () => {
    const v = createVerifier();
    expect(v).toMatch(/^[A-Za-z0-9\-_]{43,128}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/web run test -- canva-pkce`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/web/lib/canva/pkce.ts
import { createHash, randomBytes } from "node:crypto";

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function createVerifier(): string {
  return b64url(randomBytes(32)); // 43 chars, url-safe
}

export function challengeFor(verifier: string): string {
  return b64url(createHash("sha256").update(verifier).digest());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @event-editor/web run test -- canva-pkce`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/canva/pkce.ts packages/web/test/canva-pkce.test.ts
git commit -m "feat(web): PKCE verifier/challenge helpers for Canva OAuth"
```

---

## Task 3: Canva OAuth module + routes

**Files:**
- Create: `packages/web/lib/canva/oauth.ts`
- Create: `packages/web/app/api/canva/auth/route.ts`
- Create: `packages/web/app/api/canva/callback/route.ts`
- Test: `packages/web/test/canva-oauth.test.ts`

**Interfaces:**
- Consumes: `createVerifier`, `challengeFor` (Task 2); `saveToken` (`@event-editor/core/tokens`).
- Produces:
  - `CANVA_REDIRECT = "http://127.0.0.1:3000/api/canva/callback"`
  - `CANVA_SCOPES: string[]`
  - `buildAuthUrl(state: string, challenge: string): string`
  - `exchangeCode(code: string, verifier: string): Promise<TokenInput>`
  - `refreshToken(refresh: string): Promise<TokenInput>`
  - `CanvaError` (Error with `status: number`)
- `TokenInput` is the existing shape from `@event-editor/core/tokens` (`{ accessToken, refreshToken, expiryMs, scope }`).

> Canva Connect endpoints (verify against https://www.canva.dev/docs/connect/ at implementation time): authorize `https://www.canva.com/api/oauth/authorize`, token `https://api.canva.com/rest/v1/oauth/token` (form-encoded, client auth via HTTP Basic `client_id:client_secret`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/test/canva-oauth.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildAuthUrl, exchangeCode } from "../lib/canva/oauth";

beforeEach(() => {
  process.env.CANVA_CLIENT_ID = "cid";
  process.env.CANVA_CLIENT_SECRET = "secret";
});

describe("canva oauth", () => {
  it("builds an authorize url with PKCE + fixed 127.0.0.1 redirect", () => {
    const url = new URL(buildAuthUrl("st8", "chal"));
    expect(url.origin + url.pathname).toBe("https://www.canva.com/api/oauth/authorize");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe("chal");
    expect(url.searchParams.get("state")).toBe("st8");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:3000/api/canva/callback");
    expect(url.searchParams.get("client_id")).toBe("cid");
  });

  it("exchanges a code into a TokenInput", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "asset:write" }),
    }));
    vi.stubGlobal("fetch", fetchMock as any);
    const tok = await exchangeCode("code123", "verifier123");
    expect(tok.accessToken).toBe("at");
    expect(tok.refreshToken).toBe("rt");
    expect(typeof tok.expiryMs).toBe("number");
    const [, init] = fetchMock.mock.calls[0];
    expect(String((init as any).body)).toContain("code_verifier=verifier123");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/web run test -- canva-oauth`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the oauth module**

```ts
// packages/web/lib/canva/oauth.ts
import type { TokenInput } from "@event-editor/core/tokens";

export const CANVA_REDIRECT = "http://127.0.0.1:3000/api/canva/callback";
export const CANVA_SCOPES = [
  "brandtemplate:meta:read",
  "brandtemplate:content:read",
  "asset:write",
  "design:content:write",
  "design:meta:read",
  "design:content:read",
];
const AUTHORIZE_URL = "https://www.canva.com/api/oauth/authorize";
const TOKEN_URL = "https://api.canva.com/rest/v1/oauth/token";

export class CanvaError extends Error {
  status: number;
  retryAfter?: number;
  constructor(message: string, status: number, retryAfter?: number) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function basicAuth(): string {
  const id = process.env.CANVA_CLIENT_ID ?? "";
  const secret = process.env.CANVA_CLIENT_SECRET ?? "";
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

export function buildAuthUrl(state: string, challenge: string): string {
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", process.env.CANVA_CLIENT_ID ?? "");
  u.searchParams.set("redirect_uri", CANVA_REDIRECT);
  u.searchParams.set("scope", CANVA_SCOPES.join(" "));
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("state", state);
  return u.toString();
}

async function tokenRequest(form: Record<string, string>): Promise<TokenInput> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basicAuth() },
    body: new URLSearchParams(form).toString(),
  });
  if (!res.ok) {
    throw new CanvaError(`canva token ${res.status}`, res.status);
  }
  const j: any = await res.json();
  return {
    accessToken: j.access_token ?? "",
    refreshToken: j.refresh_token ?? null,
    expiryMs: j.expires_in ? Date.now() + j.expires_in * 1000 : null,
    scope: j.scope ?? null,
  };
}

export function exchangeCode(code: string, verifier: string): Promise<TokenInput> {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: CANVA_REDIRECT,
  });
}

export function refreshToken(refresh: string): Promise<TokenInput> {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refresh });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @event-editor/web run test -- canva-oauth`
Expected: PASS.

- [ ] **Step 5: Implement the auth route**

PKCE verifier + state are stored in short-lived httpOnly cookies, read back on callback.

```ts
// packages/web/app/api/canva/auth/route.ts
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { buildAuthUrl, CANVA_REDIRECT } from "@/lib/canva/oauth";
import { createVerifier, challengeFor } from "@/lib/canva/pkce";

export const runtime = "nodejs";

export async function GET() {
  if (!process.env.CANVA_CLIENT_ID) {
    return NextResponse.redirect(new URL("/settings?canva=error", CANVA_REDIRECT));
  }
  const state = randomBytes(16).toString("hex");
  const verifier = createVerifier();
  const res = NextResponse.redirect(buildAuthUrl(state, challengeFor(verifier)));
  const opts = { httpOnly: true, sameSite: "lax" as const, maxAge: 600, path: "/" };
  res.cookies.set("canva_state", state, opts);
  res.cookies.set("canva_verifier", verifier, opts);
  return res;
}
```

- [ ] **Step 6: Implement the callback route**

```ts
// packages/web/app/api/canva/callback/route.ts
import { NextResponse } from "next/server";
import { exchangeCode } from "@/lib/canva/oauth";
import { saveToken } from "@event-editor/core/tokens";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = request.headers.get("cookie") ?? "";
  const cookieState = /canva_state=([^;]+)/.exec(jar)?.[1];
  const verifier = /canva_verifier=([^;]+)/.exec(jar)?.[1];

  if (!code || !state || !verifier || state !== cookieState) {
    return NextResponse.redirect(new URL("/settings?canva=error", request.url));
  }
  try {
    const token = await exchangeCode(code, verifier);
    saveToken(getDb(), "canva", token);
    const res = NextResponse.redirect(new URL("/settings?canva=connected", request.url));
    res.cookies.delete("canva_state");
    res.cookies.delete("canva_verifier");
    return res;
  } catch {
    return NextResponse.redirect(new URL("/settings?canva=error", request.url));
  }
}
```

- [ ] **Step 7: Run the full web suite + typecheck**

Run: `npm -w @event-editor/web run test && npm -w @event-editor/web run build`
Expected: PASS, build clean.

- [ ] **Step 8: Commit**

```bash
git add packages/web/lib/canva/oauth.ts packages/web/test/canva-oauth.test.ts \
  packages/web/app/api/canva/auth/route.ts packages/web/app/api/canva/callback/route.ts
git commit -m "feat(web): Canva Connect PKCE OAuth module + auth/callback routes"
```

---

## Task 4: Canva API client

**Files:**
- Create: `packages/web/lib/canva/client.ts`
- Test: `packages/web/test/canva-client.test.ts`

**Interfaces:**
- Consumes: `withBackoff` (Task 1); `refreshToken`, `CanvaError` (Task 3); `getToken`/`saveToken` (`@event-editor/core/tokens`); `getDb` (`@/lib/db`).
- Produces a factory `makeCanvaClient(db): CanvaClient` where:
  - `listBrandTemplates(): Promise<{ id: string; title: string }[]>`
  - `getDataset(templateId: string): Promise<CanvaDataset>` — `CanvaDataset = { fields: { name: string; type: "image" | "text" | string }[] }`
  - `uploadAsset(bytes: Buffer, name: string): Promise<string>` (asset id; create→poll)
  - `createAutofill(templateId: string, data: AutofillData): Promise<string>` (design id; create→poll)
  - `exportPng(designId: string): Promise<string>` (export url; create→poll)
  - `download(url: string): Promise<Buffer>`
  - `AutofillData = Record<string, { type: "text"; text: string } | { type: "image"; asset_id: string }>`

> Endpoints to verify at implementation time (Canva Connect v1): `GET /v1/brand-templates`, `GET /v1/brand-templates/{id}/dataset`, `POST /v1/asset-uploads` + `GET /v1/asset-uploads/{job}`, `POST /v1/autofills` + `GET /v1/autofills/{job}`, `POST /v1/exports` + `GET /v1/exports/{job}`. Job responses carry `{ job: { status: "in_progress"|"success"|"failed", ... } }`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/test/canva-client.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeCanvaClient } from "../lib/canva/client";

function fakeDb() {
  return {} as any; // token accessor is stubbed via the token module mock below
}

vi.mock("@event-editor/core/tokens", () => ({
  getToken: () => ({ provider: "canva", accessToken: "at", refreshToken: "rt", expiryMs: null, scope: null }),
  saveToken: vi.fn(),
}));

function jsonRes(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body, arrayBuffer: async () => new ArrayBuffer(0) };
}

beforeEach(() => vi.unstubAllGlobals());

describe("canva client", () => {
  it("lists brand templates", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonRes({ items: [{ id: "t1", title: "Speaker" }] })) as any);
    const out = await makeCanvaClient(fakeDb()).listBrandTemplates();
    expect(out).toEqual([{ id: "t1", title: "Speaker" }]);
  });

  it("polls an autofill job to a design id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ job: { id: "j1", status: "in_progress" } }))   // POST create
      .mockResolvedValueOnce(jsonRes({ job: { id: "j1", status: "in_progress" } }))   // GET poll
      .mockResolvedValueOnce(jsonRes({ job: { id: "j1", status: "success", result: { design: { id: "d9" } } } }));
    vi.stubGlobal("fetch", fetchMock as any);
    const id = await makeCanvaClient(fakeDb()).createAutofill("t1", {
      name: { type: "text", text: "Ada" },
    });
    expect(id).toBe("d9");
  });

  it("throws CanvaError on a failed export job", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ job: { id: "e1", status: "in_progress" } }))
      .mockResolvedValueOnce(jsonRes({ job: { id: "e1", status: "failed", error: { message: "no access" } } }));
    vi.stubGlobal("fetch", fetchMock as any);
    await expect(makeCanvaClient(fakeDb()).exportPng("d9")).rejects.toThrow(/no access/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/web run test -- canva-client`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the client**

```ts
// packages/web/lib/canva/client.ts
import type { openDb } from "@event-editor/core/db";
import { getToken, saveToken } from "@event-editor/core/tokens";
import { withBackoff } from "../backoff";
import { CanvaError, refreshToken } from "./oauth";

const BASE = "https://api.canva.com/rest/v1";
type Db = ReturnType<typeof openDb>;

export type CanvaDataset = { fields: { name: string; type: string }[] };
export type AutofillData = Record<
  string,
  { type: "text"; text: string } | { type: "image"; asset_id: string }
>;

export interface CanvaClient {
  listBrandTemplates(): Promise<{ id: string; title: string }[]>;
  getDataset(templateId: string): Promise<CanvaDataset>;
  uploadAsset(bytes: Buffer, name: string): Promise<string>;
  createAutofill(templateId: string, data: AutofillData): Promise<string>;
  exportPng(designId: string): Promise<string>;
  download(url: string): Promise<Buffer>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function makeCanvaClient(db: Db): CanvaClient {
  async function token(): Promise<string> {
    const stored = getToken(db, "canva");
    if (!stored) throw new CanvaError("Canva is not connected", 401);
    if (stored.expiryMs && stored.expiryMs < Date.now() + 30_000 && stored.refreshToken) {
      const fresh = await refreshToken(stored.refreshToken);
      saveToken(db, "canva", fresh);
      return fresh.accessToken;
    }
    return stored.accessToken;
  }

  async function call(path: string, init: RequestInit = {}, isRetry = false): Promise<any> {
    const at = await token();
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${at}`, ...(init.headers ?? {}) },
    });
    if (res.status === 401 && !isRetry) {
      const stored = getToken(db, "canva");
      if (stored?.refreshToken) {
        saveToken(db, "canva", await refreshToken(stored.refreshToken));
        return call(path, init, true);
      }
    }
    if (!res.ok) {
      const retryAfter = Number(res.headers?.get?.("retry-after")) || undefined;
      throw new CanvaError(`canva ${init.method ?? "GET"} ${path} -> ${res.status}`, res.status, retryAfter);
    }
    return res.json();
  }

  // poll a job endpoint until success|failed; returns the job object
  async function pollJob(path: string, extract: (job: any) => unknown): Promise<unknown> {
    for (let i = 0; i < 60; i++) {
      const body = await withBackoff(() => call(path), { retryOn: (s) => s === 429 || (s ?? 0) >= 500 });
      const job = body.job ?? body;
      if (job.status === "success") return extract(job);
      if (job.status === "failed") {
        throw new CanvaError(job.error?.message ?? "canva job failed", 422);
      }
      await sleep(2000);
    }
    throw new CanvaError("canva job timed out", 504);
  }

  const jpost = (path: string, body: unknown) =>
    withBackoff(
      () => call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      { retryOn: (s) => s === 429 || (s ?? 0) >= 500 },
    );

  return {
    async listBrandTemplates() {
      const body = await withBackoff(() => call("/brand-templates"), { retryOn: (s) => s === 429 || (s ?? 0) >= 500 });
      return (body.items ?? []).map((t: any) => ({ id: t.id, title: t.title ?? "(untitled)" }));
    },

    async getDataset(templateId) {
      const body = await call(`/brand-templates/${templateId}/dataset`);
      const dataset = body.dataset ?? body;
      const fields = Object.entries(dataset ?? {}).map(([name, def]: [string, any]) => ({
        name,
        type: def?.type ?? "unknown",
      }));
      return { fields };
    },

    async uploadAsset(bytes, name) {
      const meta = Buffer.from(name).toString("base64");
      const created = await withBackoff(
        () =>
          call("/asset-uploads", {
            method: "POST",
            headers: {
              "Content-Type": "application/octet-stream",
              "Asset-Upload-Metadata": JSON.stringify({ name_base64: meta }),
            },
            body: bytes as any,
          }),
        { retryOn: (s) => s === 429 || (s ?? 0) >= 500 },
      );
      const jobId = (created.job ?? created).id;
      return (await pollJob(`/asset-uploads/${jobId}`, (j) => j.asset?.id ?? j.result?.asset?.id)) as string;
    },

    async createAutofill(templateId, data) {
      const created = await jpost("/autofills", { brand_template_id: templateId, data });
      const jobId = (created.job ?? created).id;
      return (await pollJob(`/autofills/${jobId}`, (j) => j.result?.design?.id ?? j.design?.id)) as string;
    },

    async exportPng(designId) {
      const created = await jpost("/exports", { design_id: designId, format: { type: "png" } });
      const jobId = (created.job ?? created).id;
      return (await pollJob(`/exports/${jobId}`, (j) => (j.urls ?? j.result?.urls ?? [])[0])) as string;
    },

    async download(url) {
      const res = await fetch(url);
      if (!res.ok) throw new CanvaError(`download ${res.status}`, res.status);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @event-editor/web run test -- canva-client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/canva/client.ts packages/web/test/canva-client.test.ts
git commit -m "feat(web): Canva Connect API client (templates, asset, autofill, export)"
```

---

## Task 5: Template field resolver

**Files:**
- Create: `packages/web/lib/canva/fields.ts`
- Test: `packages/web/test/canva-fields.test.ts`

**Interfaces:**
- Consumes: `CanvaDataset` (Task 4).
- Produces: `resolveTemplateFields(dataset: CanvaDataset): { photo: string; name: string; title: string }` — returns the field names, throws `Error` listing what's missing. Convention: an image field named `photo`, text fields `name` and `title`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/test/canva-fields.test.ts
import { describe, it, expect } from "vitest";
import { resolveTemplateFields } from "../lib/canva/fields";

const ok = { fields: [
  { name: "photo", type: "image" },
  { name: "name", type: "text" },
  { name: "title", type: "text" },
] };

describe("resolveTemplateFields", () => {
  it("maps the convention fields", () => {
    expect(resolveTemplateFields(ok)).toEqual({ photo: "photo", name: "name", title: "title" });
  });

  it("errors listing missing fields", () => {
    expect(() => resolveTemplateFields({ fields: [{ name: "photo", type: "image" }] }))
      .toThrow(/name.*title/);
  });

  it("errors when photo is not an image field", () => {
    expect(() => resolveTemplateFields({ fields: [
      { name: "photo", type: "text" }, { name: "name", type: "text" }, { name: "title", type: "text" },
    ] })).toThrow(/photo/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/web run test -- canva-fields`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/web/lib/canva/fields.ts
import type { CanvaDataset } from "./client";

export function resolveTemplateFields(dataset: CanvaDataset): { photo: string; name: string; title: string } {
  const by = new Map(dataset.fields.map((f) => [f.name, f.type]));
  const missing: string[] = [];
  if (by.get("photo") !== "image") missing.push("photo (image field)");
  if (by.get("name") !== "text") missing.push("name (text field)");
  if (by.get("title") !== "text") missing.push("title (text field)");
  if (missing.length) {
    throw new Error(`Template is missing required fields: ${missing.join(", ")}. Add them in Canva.`);
  }
  return { photo: "photo", name: "name", title: "title" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @event-editor/web run test -- canva-fields`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/canva/fields.ts packages/web/test/canva-fields.test.ts
git commit -m "feat(web): Canva template field resolver (photo/name/title convention)"
```

---

## Task 6: Core `createCanvaHeadshot` + `runHeadshotCanva`

**Files:**
- Modify: `packages/core/src/headshot.ts`
- Test: `packages/core/test/headshot-canva.test.ts`

**Interfaces:**
- Consumes: existing `headshots` schema; existing `touch` helper in the file.
- Produces:
  - `createCanvaHeadshot(db, { driveFileId, canvaTemplateId, nameText, titleText }): number` — inserts `renderer:"canva"`, `canvaTemplateId`, `templateId:null`, `status:"autofilling"`.
  - `CanvaRenderDeps` interface:

    ```ts
    export interface CanvaRenderDeps {
      loadPhoto(driveFileId: string): Promise<Buffer>;
      getDataset(templateId: string): Promise<{ fields: { name: string; type: string }[] }>;
      resolveFields(dataset: { fields: { name: string; type: string }[] }): { photo: string; name: string; title: string };
      uploadAsset(photo: Buffer, name: string): Promise<string>;
      autofill(templateId: string, data: Record<string, { type: "text"; text: string } | { type: "image"; asset_id: string }>): Promise<string>;
      exportPng(designId: string): Promise<string>;
      download(url: string): Promise<Buffer>;
      save(id: number, png: Buffer): Promise<string>;
    }
    ```
  - `runHeadshotCanva(db, id, deps: CanvaRenderDeps): Promise<void>` — drives status `autofilling → exporting → done`, persists `designId`/`exportUrl`/`outputPath`; on any throw sets `status:"error"` + `errorMessage`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/headshot-canva.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openDb, runMigrations, headshots } from "../src/index.js";
import { createCanvaHeadshot, runHeadshotCanva, type CanvaRenderDeps } from "../src/headshot.js";

function freshDb() {
  const db = openDb(join(tmpdir(), `ee-hsc-${Math.random().toString(36).slice(2)}.db`));
  runMigrations(db);
  return db;
}

const dataset = { fields: [
  { name: "photo", type: "image" }, { name: "name", type: "text" }, { name: "title", type: "text" },
] };

function happyDeps(calls: string[]): CanvaRenderDeps {
  return {
    loadPhoto: async () => Buffer.from("img"),
    getDataset: async () => dataset,
    resolveFields: () => ({ photo: "photo", name: "name", title: "title" }),
    uploadAsset: async () => { calls.push("upload"); return "asset1"; },
    autofill: async (_t, data) => { calls.push("autofill:" + JSON.stringify(data.photo)); return "design1"; },
    exportPng: async () => { calls.push("export"); return "https://x/y.png"; },
    download: async () => Buffer.from("png"),
    save: async () => "data/headshots/1.png",
  };
}

let db: ReturnType<typeof freshDb>;
beforeEach(() => { db = freshDb(); });

describe("runHeadshotCanva", () => {
  it("walks autofilling -> exporting -> done and stores ids", async () => {
    const id = createCanvaHeadshot(db, { driveFileId: "f1", canvaTemplateId: "t1", nameText: "Ada", titleText: "CTO" });
    const before = db.select().from(headshots).where(eq(headshots.id, id)).all()[0];
    expect(before.status).toBe("autofilling");
    expect(before.renderer).toBe("canva");

    const calls: string[] = [];
    await runHeadshotCanva(db, id, happyDeps(calls));
    const row = db.select().from(headshots).where(eq(headshots.id, id)).all()[0];
    expect(row.status).toBe("done");
    expect(row.designId).toBe("design1");
    expect(row.exportUrl).toBe("https://x/y.png");
    expect(row.outputPath).toBe("data/headshots/1.png");
    expect(calls).toEqual(["upload", 'autofill:{"type":"image","asset_id":"asset1"}', "export"]);
  });

  it("records error on a 403-style failure", async () => {
    const id = createCanvaHeadshot(db, { driveFileId: "f1", canvaTemplateId: "t1", nameText: "Ada", titleText: "CTO" });
    const deps = happyDeps([]);
    deps.exportPng = async () => { throw new Error("needs Canva Teams/Enterprise"); };
    await runHeadshotCanva(db, id, deps);
    const row = db.select().from(headshots).where(eq(headshots.id, id)).all()[0];
    expect(row.status).toBe("error");
    expect(row.errorMessage).toMatch(/Teams\/Enterprise/);
  });

  it("errors clearly when fields are missing", async () => {
    const id = createCanvaHeadshot(db, { driveFileId: "f1", canvaTemplateId: "t1", nameText: "Ada", titleText: "CTO" });
    const deps = happyDeps([]);
    deps.resolveFields = () => { throw new Error("missing required fields: name (text field)"); };
    await runHeadshotCanva(db, id, deps);
    const row = db.select().from(headshots).where(eq(headshots.id, id)).all()[0];
    expect(row.status).toBe("error");
    expect(row.errorMessage).toMatch(/missing required fields/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/core run test -- headshot-canva`
Expected: FAIL — `createCanvaHeadshot` / `runHeadshotCanva` not exported.

- [ ] **Step 3: Implement (append to `packages/core/src/headshot.ts`)**

```ts
export interface CreateCanvaHeadshotArgs {
  driveFileId: string;
  canvaTemplateId: string;
  nameText: string;
  titleText: string;
}

export function createCanvaHeadshot(db: BetterSQLite3Database<any>, args: CreateCanvaHeadshotArgs): number {
  const now = Date.now();
  const res = db
    .insert(headshots)
    .values({
      source: "drive",
      sourceDriveFileId: args.driveFileId,
      renderer: "canva",
      canvaTemplateId: args.canvaTemplateId,
      templateId: null,
      nameText: args.nameText,
      titleText: args.titleText,
      status: "autofilling",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return Number(res.lastInsertRowid);
}

export interface CanvaRenderDeps {
  loadPhoto(driveFileId: string): Promise<Buffer>;
  getDataset(templateId: string): Promise<{ fields: { name: string; type: string }[] }>;
  resolveFields(dataset: { fields: { name: string; type: string }[] }): { photo: string; name: string; title: string };
  uploadAsset(photo: Buffer, name: string): Promise<string>;
  autofill(
    templateId: string,
    data: Record<string, { type: "text"; text: string } | { type: "image"; asset_id: string }>,
  ): Promise<string>;
  exportPng(designId: string): Promise<string>;
  download(url: string): Promise<Buffer>;
  save(id: number, png: Buffer): Promise<string>;
}

export async function runHeadshotCanva(
  db: BetterSQLite3Database<any>,
  id: number,
  deps: CanvaRenderDeps,
): Promise<void> {
  try {
    const row = db.select().from(headshots).where(eq(headshots.id, id)).all()[0];
    if (!row) throw new Error(`headshot ${id} not found`);
    const templateId = row.canvaTemplateId;
    if (!templateId) throw new Error(`headshot ${id} has no canva template`);

    const dataset = await deps.getDataset(templateId);
    const fields = deps.resolveFields(dataset);

    const photo = await deps.loadPhoto(row.sourceDriveFileId!);
    const assetId = await deps.uploadAsset(photo, `headshot-${id}`);
    const data = {
      [fields.photo]: { type: "image" as const, asset_id: assetId },
      [fields.name]: { type: "text" as const, text: row.nameText ?? "" },
      [fields.title]: { type: "text" as const, text: row.titleText ?? "" },
    };
    const designId = await deps.autofill(templateId, data);
    touch(db, id, { designId, status: "exporting" });

    const url = await deps.exportPng(designId);
    touch(db, id, { exportUrl: url });
    const png = await deps.download(url);
    const path = await deps.save(id, png);
    touch(db, id, { outputPath: path, status: "done" });
  } catch (err) {
    touch(db, id, { status: "error", errorMessage: err instanceof Error ? err.message : String(err) });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @event-editor/core run test -- headshot-canva`
Expected: PASS.

- [ ] **Step 5: Build core (web consumes the compiled subpath) and commit**

```bash
npm -w @event-editor/core run build
git add packages/core/src/headshot.ts packages/core/test/headshot-canva.test.ts
git commit -m "feat(core): createCanvaHeadshot + runHeadshotCanva DI pipeline"
```

---

## Task 7: `headshotStatusView` covers Canva states

**Files:**
- Modify: `packages/web/lib/status.ts`
- Test: `packages/web/test/status.test.ts` (add cases; create the file if absent)

**Interfaces:**
- Consumes/Produces: existing `headshotStatusView(status: string): StatusView`.

- [ ] **Step 1: Write the failing test (add to the existing status test file, or create it)**

```ts
// packages/web/test/status.test.ts  (add these cases)
import { describe, it, expect } from "vitest";
import { headshotStatusView } from "../lib/status";

describe("headshotStatusView canva states", () => {
  it("maps autofilling", () => {
    expect(headshotStatusView("autofilling")).toEqual({ tone: "active", label: "Filling Canva template" });
  });
  it("maps exporting", () => {
    expect(headshotStatusView("exporting")).toEqual({ tone: "active", label: "Exporting from Canva" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/web run test -- status`
Expected: FAIL — both currently fall through to `{ tone: "idle", label: status }`.

- [ ] **Step 3: Add the two cases in `headshotStatusView`**

```ts
    case "rendering": return { tone: "active", label: "Rendering" };
    case "autofilling": return { tone: "active", label: "Filling Canva template" };
    case "exporting": return { tone: "active", label: "Exporting from Canva" };
    case "done": return { tone: "success", label: "Done" };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @event-editor/web run test -- status`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/status.ts packages/web/test/status.test.ts
git commit -m "feat(web): headshotStatusView maps autofilling/exporting"
```

---

## Task 8: Web glue — `startHeadshotCanva`, templates route, POST branch

**Files:**
- Modify: `packages/web/lib/studio.ts`
- Create: `packages/web/app/api/studio/templates/route.ts`
- Modify: `packages/web/app/api/studio/headshots/route.ts`
- Test: `packages/web/test/studio-canva.test.ts`

**Interfaces:**
- Consumes: `makeCanvaClient` (Task 4), `resolveTemplateFields` (Task 5), `createCanvaHeadshot`/`runHeadshotCanva` (Task 6), existing `authedDriveClient`/`makeDriveClient`, `HEADSHOT_DIR`.
- Produces: `startHeadshotCanva(db, drive, id): void`.

- [ ] **Step 1: Write the failing test (glue wiring is unit-tested at the deps level)**

```ts
// packages/web/test/studio-canva.test.ts
import { describe, it, expect, vi } from "vitest";
import { buildCanvaDeps } from "../lib/studio";

describe("buildCanvaDeps", () => {
  it("wires drive download + canva client + field resolver into CanvaRenderDeps", async () => {
    const drive = { downloadFile: vi.fn(async () => Buffer.from("p")) } as any;
    const canva = {
      getDataset: vi.fn(async () => ({ fields: [
        { name: "photo", type: "image" }, { name: "name", type: "text" }, { name: "title", type: "text" }] })),
      uploadAsset: vi.fn(async () => "a1"),
      createAutofill: vi.fn(async () => "d1"),
      exportPng: vi.fn(async () => "u1"),
      download: vi.fn(async () => Buffer.from("png")),
    } as any;
    const deps = buildCanvaDeps(drive, canva);
    expect(await deps.loadPhoto("f1")).toEqual(Buffer.from("p"));
    const ds = await deps.getDataset("t1");
    expect(deps.resolveFields(ds)).toEqual({ photo: "photo", name: "name", title: "title" });
    expect(await deps.autofill("t1", {} as any)).toBe("d1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/web run test -- studio-canva`
Expected: FAIL — `buildCanvaDeps` not exported.

- [ ] **Step 3: Extend `packages/web/lib/studio.ts`**

```ts
import { runHeadshotCanva, type CanvaRenderDeps } from "@event-editor/core/headshot";
import type { CanvaClient } from "./canva/client";
import { makeCanvaClient } from "./canva/client";
import { resolveTemplateFields } from "./canva/fields";

export function buildCanvaDeps(drive: DriveClient, canva: CanvaClient): CanvaRenderDeps {
  return {
    loadPhoto: (fileId) => drive.downloadFile(fileId),
    getDataset: (templateId) => canva.getDataset(templateId),
    resolveFields: (dataset) => resolveTemplateFields(dataset),
    uploadAsset: (photo, name) => canva.uploadAsset(photo, name),
    autofill: (templateId, data) => canva.createAutofill(templateId, data),
    exportPng: (designId) => canva.exportPng(designId),
    download: (url) => canva.download(url),
    save: async (hid, png) => {
      await mkdir(resolve(HEADSHOT_DIR), { recursive: true });
      const rel = `${HEADSHOT_DIR}/${hid}.png`;
      await writeFile(resolve(rel), png);
      return rel;
    },
  };
}

export function startHeadshotCanva(db: Db, drive: DriveClient, id: number): void {
  void runHeadshotCanva(db, id, buildCanvaDeps(drive, makeCanvaClient(db)));
}
```

- [ ] **Step 4: Create the templates route**

```ts
// packages/web/app/api/studio/templates/route.ts
import { NextResponse } from "next/server";
import { getToken } from "@event-editor/core/tokens";
import { getDb } from "@/lib/db";
import { makeCanvaClient } from "@/lib/canva/client";

export const runtime = "nodejs";

export async function GET() {
  const db = getDb();
  if (!getToken(db, "canva")) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  try {
    const templates = await makeCanvaClient(db).listBrandTemplates();
    return NextResponse.json({ templates });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 502 });
  }
}
```

- [ ] **Step 5: Branch the headshots POST route on `renderer`**

Replace the body of `POST` in `packages/web/app/api/studio/headshots/route.ts`:

```ts
import { createHeadshot, createCanvaHeadshot } from "@event-editor/core/headshot";
import { startHeadshot, startHeadshotCanva } from "@/lib/studio";
// ...existing imports (getFrame, headshots, getDb, authedDriveClient, makeDriveClient, toHeadshotDto)

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const renderer = body?.renderer === "canva" ? "canva" : "local";
  const driveFileId = body?.driveFileId;
  if (!driveFileId) return NextResponse.json({ error: "driveFileId required" }, { status: 400 });

  const db = getDb();
  const drive = await authedDriveClient(db);
  if (!drive) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  const driveClient = makeDriveClient(drive);

  if (renderer === "canva") {
    const templateId = body?.templateId;
    if (!templateId) return NextResponse.json({ error: "templateId required" }, { status: 400 });
    const id = createCanvaHeadshot(db, {
      driveFileId, canvaTemplateId: templateId,
      nameText: body?.nameText ?? "", titleText: body?.titleText ?? "",
    });
    startHeadshotCanva(db, driveClient, id);
    return NextResponse.json({ id });
  }

  const frameId = body?.frameId;
  if (!frameId || !getFrame(frameId)) return NextResponse.json({ error: "unknown frame" }, { status: 400 });
  const id = createHeadshot(db, {
    driveFileId, frameId, nameText: body?.nameText ?? "", titleText: body?.titleText ?? "",
  });
  startHeadshot(db, driveClient, id);
  return NextResponse.json({ id });
}
```

- [ ] **Step 6: Run tests + build**

Run: `npm -w @event-editor/web run test && npm -w @event-editor/web run build`
Expected: PASS, build clean.

- [ ] **Step 7: Commit**

```bash
git add packages/web/lib/studio.ts packages/web/app/api/studio/templates/route.ts \
  packages/web/app/api/studio/headshots/route.ts packages/web/test/studio-canva.test.ts
git commit -m "feat(web): canva studio glue, templates route, renderer branch on POST"
```

---

## Task 9: Settings Canva connect card

**Files:**
- Modify: `packages/web/app/settings/page.tsx`
- Test: none (server component, covered by manual + build).

**Interfaces:**
- Consumes: `getToken(db, "canva")`, `process.env.CANVA_CLIENT_ID`.

- [ ] **Step 1: Add Canva state + card to the settings page**

Extend the `searchParams` type to include `canva`, read the canva token, and render a card mirroring Google. Insert after the Google `<ul>`/banner logic:

```tsx
// in SettingsBody: widen the destructure
  const { google, canva } = await searchParams;
  const canvaConfigured = !!process.env.CANVA_CLIENT_ID;
  const canvaToken = getToken(getDb(), "canva");
```

Add banners next to the Google ones:

```tsx
      {canva === "connected" && <p className="mt-3 text-success">Canva connected.</p>}
      {canva === "error" && <p className="mt-3 text-danger">Canva connection failed. Check CANVA_CLIENT_ID and try again.</p>}
```

Add a card row (after the existing `<ul>`):

```tsx
      <ul className="mt-3 space-y-3">
        <li className="card flex items-center justify-between">
          <span>Canva (Headshot Studio)</span>
          <span className="flex items-center gap-3">
            <span className={canvaToken ? "text-success" : canvaConfigured ? "text-muted" : "text-danger"}>
              {canvaToken ? "Connected" : canvaConfigured ? "Not connected" : "Set CANVA_CLIENT_ID"}
            </span>
            {canvaConfigured && (
              <a className="btn" href="/api/canva/auth">{canvaToken ? "Re-auth" : "Connect"}</a>
            )}
          </span>
        </li>
      </ul>
```

Update the `searchParams` type signatures in both `Settings` and `SettingsBody` to `Promise<{ google?: string; canva?: string }>`.

- [ ] **Step 2: Build to typecheck**

Run: `npm -w @event-editor/web run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/web/app/settings/page.tsx
git commit -m "feat(web): Canva connect card on settings"
```

---

## Task 10: StudioClient renderer toggle + Canva flow

**Files:**
- Modify: `packages/web/app/studio/StudioClient.tsx`
- Test: none (client component; covered by build + manual verification).

**Interfaces:**
- Consumes: `/api/studio/templates`, `POST /api/studio/headshots` (renderer/templateId), existing polling.

- [ ] **Step 1: Add renderer + template state**

Near the other `useState` calls:

```tsx
  const [renderer, setRenderer] = useState<"local" | "canva">("local");
  const [templates, setTemplates] = useState<{ id: string; title: string }[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [canvaConnected, setCanvaConnected] = useState<boolean | null>(null);
```

- [ ] **Step 2: Load templates when the Canva tab is first selected**

```tsx
  useEffect(() => {
    if (renderer !== "canva" || canvaConnected !== null) return;
    fetch("/api/studio/templates").then(async (r) => {
      if (r.status === 401) { setCanvaConnected(false); return; }
      setCanvaConnected(true);
      setTemplates((await r.json()).templates ?? []);
    }).catch(() => setCanvaConnected(false));
  }, [renderer, canvaConnected]);
```

- [ ] **Step 3: Render the toggle + conditional styling control**

Replace the frame-picker block with a renderer toggle, then branch:

```tsx
      <div className="mt-6">
        <p className="eyebrow">Renderer</p>
        <div className="mt-2 inline-flex rounded-lg border border-edge p-1">
          {(["local", "canva"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRenderer(r)}
              className={`px-4 py-1.5 rounded-md text-sm ${renderer === r ? "bg-accent text-on-accent" : "text-muted"}`}
            >
              {r === "local" ? "Local" : "Canva"}
            </button>
          ))}
        </div>
      </div>

      {renderer === "local" && (
        <label className="mt-4 block">
          <span className="eyebrow">Frame</span>
          <select className="input mt-1" value={frameId} onChange={(e) => setFrameId(e.target.value)}>
            {FRAME_LIST.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </label>
      )}

      {renderer === "canva" && canvaConnected === false && (
        <p className="mt-4 text-sm text-muted">
          Canva is not connected. <a className="underline" href="/settings">Connect it in settings</a>.
        </p>
      )}

      {renderer === "canva" && canvaConnected && (
        <label className="mt-4 block">
          <span className="eyebrow">Brand template</span>
          <select className="input mt-1" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">Select a template</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </label>
      )}
```

(Use the project's existing class names if `eyebrow`/`input`/`btn`/`bg-accent` differ — match the local block's current markup.)

- [ ] **Step 4: Branch `generate()` and its disabled-reason**

```tsx
  async function generate() {
    if (!fileId) return;
    if (renderer === "canva" && !templateId) return;
    if (renderer === "local" && !frameId) return;
    setBusy(true); setErr(null);
    try {
      const payload = renderer === "canva"
        ? { renderer, driveFileId: fileId, templateId, nameText, titleText }
        : { renderer, driveFileId: fileId, frameId, nameText, titleText };
      const r = await fetch("/api/studio/headshots", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "failed to start");
      setHsId(d.id); setHs(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }
```

Update the generate button's `disabled` to cover both renderers, e.g.
`disabled={busy || !fileId || (renderer === "canva" ? !templateId : !frameId)}`
and a disabled-reason line: `Pick a photo and a {renderer === "canva" ? "template" : "frame"} first.`

- [ ] **Step 5: Reset canva fields in `startOver()`**

Add to the existing `startOver()`:

```tsx
    setTemplateId("");
    setHsId(null);
    setHs(null);
```

(`renderer`, `canvaConnected`, and the loaded `templates` persist — only the in-flight selection resets, matching the local path's behaviour. The retry-in-place path keeps minting a new `hsId` exactly as today.)

- [ ] **Step 6: Build + run**

Run: `npm -w @event-editor/web run build`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/web/app/studio/StudioClient.tsx
git commit -m "feat(web): studio renderer toggle + Canva brand-template flow"
```

---

## Task 11: Operator setup doc + env

**Files:**
- Create: `docs/setup/canva.md`
- Modify: `.env.example`, `README.md`

- [ ] **Step 1: Write `docs/setup/canva.md`**

Cover, concretely:
1. Plan requirement: Canva **Teams/Enterprise** (free/Pro get 403 on autofill/export).
2. Create a Connect integration at the Canva developer portal; set redirect `http://127.0.0.1:3000/api/canva/callback`; enable scopes `brandtemplate:meta:read`, `brandtemplate:content:read`, `asset:write`, `design:content:write`, `design:meta:read`, `design:content:read`.
3. Build a brand template with data fields named exactly `photo` (image), `name` (text), `title` (text).
4. Put `CANVA_CLIENT_ID` + `CANVA_CLIENT_SECRET` in root `.env`.
5. Start the app, open `/settings`, click **Connect** under Canva, approve.
6. Open `/studio`, switch the renderer to **Canva**, pick the template, generate.
7. Note: dev server must be reachable at `127.0.0.1:3000` (not `localhost`) for the callback to match.

- [ ] **Step 2: Add env placeholders to `.env.example`**

```
# Canva Connect (Headshot Studio Canva renderer) — Teams/Enterprise plan required
CANVA_CLIENT_ID=
CANVA_CLIENT_SECRET=
```

- [ ] **Step 3: Add a README pointer**

Under the Headshot Studio section, add: "Canva renderer setup: see `docs/setup/canva.md`."

- [ ] **Step 4: Commit**

```bash
git add docs/setup/canva.md .env.example README.md
git commit -m "docs: Canva renderer setup guide + env placeholders"
```

---

## Self-Review notes (author)

- **Spec coverage:** OAuth+routes (T3), client (T4), field convention (T5), pipeline+status union (T6), status view follow-up (T7), toggle/templates/POST branch (T8), settings card (T9), UI (T10), prereq doc + env (T11), shared backoff reuse (T1). Unified output path is in T6/T8 `save`. No migration — asserted against the live schema. Asset cleanup + design dedup remain non-goals (not built). 4c untouched — `runHeadshotCanva` takes a fully-resolved row, so 4c loops it.
- **Endpoint caveat:** exact Canva Connect request/response shapes (`items` vs `data`, job `result` nesting, asset-upload header) must be confirmed against https://www.canva.dev/docs/connect/ during T4; the client centralizes those so corrections are one-file.
- **Type consistency:** `CanvaRenderDeps` in T6 matches `buildCanvaDeps` in T8; `CanvaDataset`/`AutofillData` from T4 flow into T5/T6/T8; `createCanvaHeadshot` status `"autofilling"` matches the schema union and T7's view.
```
