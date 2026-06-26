# event-editor — Plan 2: Drive Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect Google Drive via OAuth, let the user pick a Drive folder, and run a scan job that lists the folder's images, downloads a thumbnail per image, and writes a `photos` row per file — with a live-polling `/sorter` UI showing progress. Ranking (heuristics + Claude) is Plan 3; this plan stops at ingested-and-listed photos.

**Architecture:** A new `oauth_tokens` table + token-store module in `@event-editor/core`. Thin Google wrappers in `packages/web/lib/google/` (`oauth.ts`, `drive.ts`) behind small interfaces so route handlers and tests never touch `googleapis` directly. A pure ingest orchestrator in `core` (`runIngest`) driven by an injected Drive client, unit-tested with a fake client. Route handlers kick ingest off as a fire-and-forget async job that mutates the `jobs`/`photos` rows; the `/sorter` page polls a status endpoint.

**Tech Stack:** `googleapis` (Google's official Node SDK), Next.js 16 route handlers, better-sqlite3 + Drizzle, Vitest.

## Global Constraints

- Node 22 target; all packages `"type": "module"`; package names `@event-editor/core`, `@event-editor/web`; env prefix `EE_`.
- Google credentials from env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (default `http://localhost:3000/api/google/callback`). OAuth scope is **read-only Drive**: `https://www.googleapis.com/auth/drive.readonly`.
- The web app imports pure/server-only core helpers via subpath exports (e.g. `@event-editor/core/tokens`), NOT the package barrel, because the barrel pulls in `better-sqlite3` (native). Add a new subpath export for any new core module.
- Thumbnails are written under `data/thumbs/<jobId>/<photoId>.jpg`. `data/` is gitignored.
- Status unions are fixed (from Plan 1): job `status` ∈ `scanning|heuristics|ranking|done|error`; photo `stage` ∈ `pending|rejected|ranked|errored`. This plan uses job `scanning` → `done` (or `error`); heuristics/ranking statuses are Plan 3. Ingested photos are left at `stage='pending'`.
- Anti-vibecode house style for all UI (light-mode palette already in `globals.css`: one accent over neutral greys, `.btn`/`.card`/`.eyebrow` classes, DM Sans, sentence-case eyebrows, no em dashes, no ALL-CAPS, no gradients/side-accent stripes). Every async action shows a feedback state (spinner/disabled + result).

---

### Task 1: OAuth token store (core)

**Files:**
- Create: `packages/core/src/tokens.ts`
- Modify: `packages/core/src/schema/index.ts` (add `oauthTokens` table)
- Modify: `packages/core/src/migrate.ts` (add `oauth_tokens` DDL)
- Modify: `packages/core/src/index.ts` (re-export `./tokens.js`)
- Modify: `packages/core/package.json` (add `./tokens` subpath export)
- Test: `packages/core/test/tokens.test.ts`

**Interfaces:**
- Consumes: `openDb` (Plan 1, `./db.js`), `runMigrations` (Plan 1).
- Produces:
  - `oauthTokens` Drizzle table: `provider` (PK text, e.g. `"google"`), `accessToken` text, `refreshToken` text nullable, `expiryMs` integer nullable, `scope` text nullable, `updatedAt` integer.
  - `saveToken(db, provider, token): void` where `token = { accessToken: string; refreshToken?: string | null; expiryMs?: number | null; scope?: string | null }`. Upsert by provider. Preserves an existing `refreshToken` when the new token omits one (Google only returns a refresh token on first consent).
  - `getToken(db, provider): StoredToken | null` where `StoredToken = { provider: string; accessToken: string; refreshToken: string | null; expiryMs: number | null; scope: string | null }`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/tokens.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, runMigrations, saveToken, getToken } from "../src/index.js";

function freshDb() {
  const path = join(tmpdir(), `ee-tok-${Math.random().toString(36).slice(2)}.db`);
  const db = openDb(path);
  runMigrations(db);
  return db;
}

describe("token store", () => {
  it("returns null when no token saved", () => {
    expect(getToken(freshDb(), "google")).toBeNull();
  });

  it("saves and reads back a token", () => {
    const db = freshDb();
    saveToken(db, "google", { accessToken: "at1", refreshToken: "rt1", expiryMs: 123, scope: "s" });
    const t = getToken(db, "google");
    expect(t).toMatchObject({ provider: "google", accessToken: "at1", refreshToken: "rt1", expiryMs: 123 });
  });

  it("upserts and preserves an existing refresh token when omitted", () => {
    const db = freshDb();
    saveToken(db, "google", { accessToken: "at1", refreshToken: "rt1" });
    saveToken(db, "google", { accessToken: "at2" }); // refresh-less refresh
    const t = getToken(db, "google");
    expect(t?.accessToken).toBe("at2");
    expect(t?.refreshToken).toBe("rt1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/core run test tokens`
Expected: FAIL — `saveToken`/`getToken` not exported.

- [ ] **Step 3: Add the `oauthTokens` table to `schema/index.ts`**

Append to `packages/core/src/schema/index.ts`:
```ts
export const oauthTokens = sqliteTable("oauth_tokens", {
  provider: text("provider").primaryKey(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiryMs: integer("expiry_ms"),
  scope: text("scope"),
  updatedAt: integer("updated_at").notNull().default(0),
});
```

- [ ] **Step 4: Add the DDL to `migrate.ts`**

Add this string to the `DDL` array in `packages/core/src/migrate.ts` (after the `headshots` entry):
```ts
  `CREATE TABLE IF NOT EXISTS oauth_tokens (
    provider TEXT PRIMARY KEY,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expiry_ms INTEGER,
    scope TEXT,
    updated_at INTEGER NOT NULL DEFAULT 0
  )`,
```

- [ ] **Step 5: Write `packages/core/src/tokens.ts`**

```ts
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { oauthTokens } from "./schema/index.js";

export interface TokenInput {
  accessToken: string;
  refreshToken?: string | null;
  expiryMs?: number | null;
  scope?: string | null;
}

export interface StoredToken {
  provider: string;
  accessToken: string;
  refreshToken: string | null;
  expiryMs: number | null;
  scope: string | null;
}

export function getToken(db: BetterSQLite3Database<any>, provider: string): StoredToken | null {
  const rows = db.select().from(oauthTokens).where(eq(oauthTokens.provider, provider)).all();
  const r = rows[0];
  if (!r) return null;
  return {
    provider: r.provider,
    accessToken: r.accessToken,
    refreshToken: r.refreshToken ?? null,
    expiryMs: r.expiryMs ?? null,
    scope: r.scope ?? null,
  };
}

export function saveToken(db: BetterSQLite3Database<any>, provider: string, token: TokenInput): void {
  const existing = getToken(db, provider);
  const refreshToken = token.refreshToken ?? existing?.refreshToken ?? null;
  const now = Date.now();
  db.insert(oauthTokens)
    .values({
      provider,
      accessToken: token.accessToken,
      refreshToken,
      expiryMs: token.expiryMs ?? null,
      scope: token.scope ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: oauthTokens.provider,
      set: {
        accessToken: token.accessToken,
        refreshToken,
        expiryMs: token.expiryMs ?? null,
        scope: token.scope ?? null,
        updatedAt: now,
      },
    })
    .run();
}
```

Note: `Date.now()` is fine in app/runtime code; it is only forbidden inside Workflow scripts, which this is not.

- [ ] **Step 6: Re-export and add subpath export**

Add to `packages/core/src/index.ts`:
```ts
export * from "./tokens.js";
```
Add to the `exports` map in `packages/core/package.json`:
```json
    "./tokens": "./dist/tokens.js",
```

- [ ] **Step 7: Run tests + build**

Run: `npm -w @event-editor/core run test`
Expected: PASS — tokens tests green, existing schema/drift/settings tests still green (the drift test now also covers `oauth_tokens`; the DDL and Drizzle table agree, so it stays green).
Run: `npm -w @event-editor/core run build`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/tokens.ts packages/core/src/schema/index.ts packages/core/src/migrate.ts packages/core/src/index.ts packages/core/package.json packages/core/test/tokens.test.ts
git commit -m "feat(core): oauth token store table and module"
```

---

### Task 2: Google OAuth client + connect/callback routes (web)

**Files:**
- Create: `packages/web/lib/google/oauth.ts`
- Create: `packages/web/app/api/google/auth/route.ts`
- Create: `packages/web/app/api/google/callback/route.ts`
- Create: `packages/web/lib/db.ts`
- Test: `packages/web/test/google-oauth.test.ts`

**Interfaces:**
- Consumes: `saveToken` / `getToken` (`@event-editor/core/tokens`), `openDb` (`@event-editor/core/db`).
- Produces:
  - `packages/web/lib/db.ts`: `getDb()` — returns a singleton `openDb()` instance for route handlers (so every handler shares one connection). Signature: `getDb(): ReturnType<typeof openDb>`.
  - `oauth.ts`:
    - `DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly"`.
    - `makeOAuthClient(): OAuth2Client` — builds a `google.auth.OAuth2` from env (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` defaulting to `http://localhost:3000/api/google/callback`).
    - `buildAuthUrl(client): string` — `generateAuthUrl` with `access_type: "offline"`, `prompt: "consent"`, `scope: [DRIVE_SCOPE]`.
    - `exchangeCode(client, code): Promise<TokenInput>` — `getToken(code)`, maps Google's `{ access_token, refresh_token, expiry_date, scope }` to our `TokenInput` (`expiryMs = expiry_date ?? null`).
    - `authedDriveClient(db): Promise<drive_v3.Drive | null>` — loads the stored google token; returns `null` if none. Sets credentials on a fresh OAuth client; attaches a `tokens` listener that calls `saveToken` so refreshed access tokens persist. Returns `google.drive({ version: "v3", auth: client })`.

- [ ] **Step 1: Write the failing test (pure mapping logic)**

`packages/web/test/google-oauth.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("googleapis", () => {
  return {
    google: {
      auth: {
        OAuth2: class {
          generateAuthUrl(opts: any) {
            return "https://accounts.google.com/o/oauth2/v2/auth?scope=" + opts.scope.join(",") +
              "&access_type=" + opts.access_type + "&prompt=" + opts.prompt;
          }
          async getToken(code: string) {
            return { tokens: { access_token: "at-" + code, refresh_token: "rt", expiry_date: 999, scope: "s" } };
          }
        },
      },
    },
  };
});

const { makeOAuthClient, buildAuthUrl, exchangeCode, DRIVE_SCOPE } = await import("../lib/google/oauth.js");

describe("google oauth helpers", () => {
  it("builds an offline consent auth url with the drive scope", () => {
    const url = buildAuthUrl(makeOAuthClient());
    expect(url).toContain(encodeURI(DRIVE_SCOPE).replace(/:/g, ":")); // scope present
    expect(url).toContain("access_type=offline");
    expect(url).toContain("prompt=consent");
  });

  it("maps an exchanged code to our token shape", async () => {
    const t = await exchangeCode(makeOAuthClient(), "abc");
    expect(t).toEqual({ accessToken: "at-abc", refreshToken: "rt", expiryMs: 999, scope: "s" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/web run test google-oauth`
Expected: FAIL — `../lib/google/oauth.js` not found.

- [ ] **Step 3: Write `packages/web/lib/db.ts`**

```ts
import { openDb } from "@event-editor/core/db";

let _db: ReturnType<typeof openDb> | null = null;

export function getDb() {
  if (!_db) _db = openDb();
  return _db;
}
```

- [ ] **Step 4: Write `packages/web/lib/google/oauth.ts`**

```ts
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type { drive_v3 } from "googleapis";
import { getToken, saveToken, type TokenInput } from "@event-editor/core/tokens";
import { openDb } from "@event-editor/core/db";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

export function makeOAuthClient(): OAuth2Client {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3000/api/google/callback",
  );
}

export function buildAuthUrl(client: OAuth2Client): string {
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [DRIVE_SCOPE],
  });
}

export async function exchangeCode(client: OAuth2Client, code: string): Promise<TokenInput> {
  const { tokens } = await client.getToken(code);
  return {
    accessToken: tokens.access_token ?? "",
    refreshToken: tokens.refresh_token ?? null,
    expiryMs: tokens.expiry_date ?? null,
    scope: tokens.scope ?? null,
  };
}

export async function authedDriveClient(
  db: ReturnType<typeof openDb>,
): Promise<drive_v3.Drive | null> {
  const stored = getToken(db, "google");
  if (!stored) return null;
  const client = makeOAuthClient();
  client.setCredentials({
    access_token: stored.accessToken,
    refresh_token: stored.refreshToken ?? undefined,
    expiry_date: stored.expiryMs ?? undefined,
  });
  client.on("tokens", (t) => {
    saveToken(db, "google", {
      accessToken: t.access_token ?? stored.accessToken,
      refreshToken: t.refresh_token ?? null,
      expiryMs: t.expiry_date ?? null,
      scope: t.scope ?? null,
    });
  });
  return google.drive({ version: "v3", auth: client });
}
```

- [ ] **Step 5: Add `googleapis` to web deps and install**

Run: `npm -w @event-editor/web install googleapis@^144.0.0`
Expected: installs `googleapis` (pulls `google-auth-library` transitively); lockfile updated.

- [ ] **Step 6: Run test to verify it passes**

Run: `npm -w @event-editor/web run test google-oauth`
Expected: PASS — both mapping tests green.

- [ ] **Step 7: Write the connect route `app/api/google/auth/route.ts`**

```ts
import { NextResponse } from "next/server";
import { makeOAuthClient, buildAuthUrl } from "@/lib/google/oauth";

export async function GET() {
  return NextResponse.redirect(buildAuthUrl(makeOAuthClient()));
}
```

- [ ] **Step 8: Write the callback route `app/api/google/callback/route.ts`**

```ts
import { NextResponse } from "next/server";
import { makeOAuthClient, exchangeCode } from "@/lib/google/oauth";
import { saveToken } from "@event-editor/core/tokens";
import { getDb } from "@/lib/db";

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(new URL("/settings?google=error", request.url));
  }
  try {
    const token = await exchangeCode(makeOAuthClient(), code);
    saveToken(getDb(), "google", token);
    return NextResponse.redirect(new URL("/settings?google=connected", request.url));
  } catch {
    return NextResponse.redirect(new URL("/settings?google=error", request.url));
  }
}
```

- [ ] **Step 9: Build web to confirm routes compile**

Run: `npm -w @event-editor/web run build`
Expected: build succeeds; `/api/google/auth` and `/api/google/callback` appear as routes.

- [ ] **Step 10: Commit**

```bash
git add packages/web/lib/db.ts packages/web/lib/google/oauth.ts packages/web/app/api/google/auth/route.ts packages/web/app/api/google/callback/route.ts packages/web/test/google-oauth.test.ts packages/web/package.json package-lock.json
git commit -m "feat(web): google oauth client and connect/callback routes"
```

---

### Task 3: Drive client wrapper (web)

**Files:**
- Create: `packages/web/lib/google/drive.ts`
- Test: `packages/web/test/drive.test.ts`

**Interfaces:**
- Consumes: `drive_v3.Drive` from `authedDriveClient` (Task 2).
- Produces (the `DriveClient` interface that Task 4's ingest depends on — defined here so the orchestrator can be tested with a fake):
  - `export interface DriveImage { id: string; name: string; mimeType: string; thumbnailLink: string | null; }`
  - `export interface DriveFolder { id: string; name: string; }`
  - `export interface DriveClient { listFolders(): Promise<DriveFolder[]>; listImages(folderId: string): Promise<DriveImage[]>; downloadThumbnail(image: DriveImage): Promise<Buffer | null>; }`
  - `makeDriveClient(drive: drive_v3.Drive): DriveClient` — concrete adapter over `googleapis`:
    - `listFolders`: `drive.files.list` with `q: "mimeType='application/vnd.google-apps.folder' and trashed=false"`, `fields: "files(id,name)"`, `pageSize: 100`, ordered by name.
    - `listImages(folderId)`: `drive.files.list` with `q: "'<folderId>' in parents and mimeType contains 'image/' and trashed=false"`, `fields: "files(id,name,mimeType,thumbnailLink)"`, paginating until no `nextPageToken`.
    - `downloadThumbnail(image)`: if `image.thumbnailLink`, fetch it with the client's auth header and return a `Buffer`; on any failure return `null` (thumbnails are best-effort).

- [ ] **Step 1: Write the failing test (adapter maps googleapis shapes)**

`packages/web/test/drive.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { makeDriveClient } from "../lib/google/drive.js";

function fakeDrive(pages: any[]) {
  let call = 0;
  return {
    files: {
      list: vi.fn(async () => ({ data: pages[Math.min(call++, pages.length - 1)] })),
    },
  } as any;
}

describe("drive client adapter", () => {
  it("lists folders", async () => {
    const drive = fakeDrive([{ files: [{ id: "f1", name: "A" }, { id: "f2", name: "B" }] }]);
    const folders = await makeDriveClient(drive).listFolders();
    expect(folders).toEqual([{ id: "f1", name: "A" }, { id: "f2", name: "B" }]);
  });

  it("paginates images across pages", async () => {
    const drive = fakeDrive([
      { files: [{ id: "i1", name: "a.jpg", mimeType: "image/jpeg", thumbnailLink: "t1" }], nextPageToken: "p2" },
      { files: [{ id: "i2", name: "b.png", mimeType: "image/png", thumbnailLink: null }] },
    ]);
    const imgs = await makeDriveClient(drive).listImages("folder1");
    expect(imgs.map((i) => i.id)).toEqual(["i1", "i2"]);
    expect(imgs[0]).toMatchObject({ name: "a.jpg", mimeType: "image/jpeg", thumbnailLink: "t1" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/web run test drive`
Expected: FAIL — `../lib/google/drive.js` not found.

- [ ] **Step 3: Write `packages/web/lib/google/drive.ts`**

```ts
import type { drive_v3 } from "googleapis";

export interface DriveImage {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink: string | null;
}
export interface DriveFolder {
  id: string;
  name: string;
}
export interface DriveClient {
  listFolders(): Promise<DriveFolder[]>;
  listImages(folderId: string): Promise<DriveImage[]>;
  downloadThumbnail(image: DriveImage): Promise<Buffer | null>;
}

export function makeDriveClient(drive: drive_v3.Drive): DriveClient {
  return {
    async listFolders() {
      const res = await drive.files.list({
        q: "mimeType='application/vnd.google-apps.folder' and trashed=false",
        fields: "files(id,name)",
        orderBy: "name",
        pageSize: 100,
      });
      return (res.data.files ?? []).map((f) => ({ id: f.id!, name: f.name ?? "(untitled)" }));
    },
    async listImages(folderId: string) {
      const out: DriveImage[] = [];
      let pageToken: string | undefined;
      do {
        const res = await drive.files.list({
          q: `'${folderId}' in parents and mimeType contains 'image/' and trashed=false`,
          fields: "nextPageToken, files(id,name,mimeType,thumbnailLink)",
          pageSize: 100,
          pageToken,
        });
        for (const f of res.data.files ?? []) {
          out.push({
            id: f.id!,
            name: f.name ?? "(untitled)",
            mimeType: f.mimeType ?? "application/octet-stream",
            thumbnailLink: f.thumbnailLink ?? null,
          });
        }
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
      return out;
    },
    async downloadThumbnail(image: DriveImage) {
      if (!image.thumbnailLink) return null;
      try {
        // drive client shares the OAuth2 auth; reuse its request to carry credentials
        const res = await (drive.context._options.auth as any).request({
          url: image.thumbnailLink,
          responseType: "arraybuffer",
        });
        return Buffer.from(res.data as ArrayBuffer);
      } catch {
        return null;
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @event-editor/web run test drive`
Expected: PASS — both adapter tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/google/drive.ts packages/web/test/drive.test.ts
git commit -m "feat(web): drive client wrapper for folders and images"
```

---

### Task 4: Ingest orchestrator (core)

**Files:**
- Create: `packages/core/src/ingest.ts`
- Modify: `packages/core/src/index.ts` (re-export `./ingest.js`)
- Modify: `packages/core/package.json` (add `./ingest` subpath export)
- Test: `packages/core/test/ingest.test.ts`

**Interfaces:**
- Consumes: `jobs`, `photos` tables; `openDb`; `runMigrations`.
- Produces:
  - `createScanJob(db, { driveFolderId, driveFolderName }): number` — inserts a `jobs` row with `status='scanning'`, `total=0`, `processed=0`, timestamps; returns the new job id.
  - `IngestDeps` interface: `{ listImages(folderId): Promise<IngestImage[]>; saveThumbnail(jobId, photoId, image): Promise<string | null>; }` where `IngestImage = { id: string; name: string; mimeType: string }`. (Thumbnail fetching is injected so this stays pure/testable; the web layer wires it to the Drive client.)
  - `runIngest(db, jobId, folderId, deps): Promise<void>` — lists images, sets `jobs.total`, inserts one `photos` row per image (`stage='pending'`, `driveFileId`, `name`, `mimeType`), calls `deps.saveThumbnail` and stores the returned path in `photos.thumbnailPath`, increments `jobs.processed` per image, and finally sets `jobs.status='done'`. On a thrown error it sets `jobs.status='error'` and `jobs.errorMessage`. Updates `jobs.updatedAt` as it goes.

- [ ] **Step 1: Write the failing test**

`packages/core/test/ingest.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, runMigrations, jobs, photos, createScanJob, runIngest } from "../src/index.js";
import { eq } from "drizzle-orm";

function freshDb() {
  const path = join(tmpdir(), `ee-ing-${Math.random().toString(36).slice(2)}.db`);
  const db = openDb(path);
  runMigrations(db);
  return db;
}

const deps = (imgs: any[]) => ({
  listImages: async () => imgs,
  saveThumbnail: async (_j: number, p: number) => `data/thumbs/x/${p}.jpg`,
});

describe("runIngest", () => {
  it("ingests images, writes photos, marks job done", async () => {
    const db = freshDb();
    const jobId = createScanJob(db, { driveFolderId: "f1", driveFolderName: "Folder" });
    await runIngest(db, jobId, "f1", deps([
      { id: "i1", name: "a.jpg", mimeType: "image/jpeg" },
      { id: "i2", name: "b.png", mimeType: "image/png" },
    ]));
    const job = db.select().from(jobs).where(eq(jobs.id, jobId)).all()[0];
    expect(job.status).toBe("done");
    expect(job.total).toBe(2);
    expect(job.processed).toBe(2);
    const rows = db.select().from(photos).where(eq(photos.jobId, jobId)).all();
    expect(rows).toHaveLength(2);
    expect(rows[0].stage).toBe("pending");
    expect(rows[0].thumbnailPath).toContain("data/thumbs");
  });

  it("empty folder finishes done with total 0", async () => {
    const db = freshDb();
    const jobId = createScanJob(db, { driveFolderId: "f1", driveFolderName: "Empty" });
    await runIngest(db, jobId, "f1", deps([]));
    const job = db.select().from(jobs).where(eq(jobs.id, jobId)).all()[0];
    expect(job.status).toBe("done");
    expect(job.total).toBe(0);
  });

  it("marks job error when listing throws", async () => {
    const db = freshDb();
    const jobId = createScanJob(db, { driveFolderId: "f1", driveFolderName: "Boom" });
    await runIngest(db, jobId, "f1", {
      listImages: async () => { throw new Error("drive down"); },
      saveThumbnail: async () => null,
    });
    const job = db.select().from(jobs).where(eq(jobs.id, jobId)).all()[0];
    expect(job.status).toBe("error");
    expect(job.errorMessage).toContain("drive down");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/core run test ingest`
Expected: FAIL — `createScanJob`/`runIngest` not exported.

- [ ] **Step 3: Write `packages/core/src/ingest.ts`**

```ts
import { eq, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { jobs, photos } from "./schema/index.js";

export interface IngestImage {
  id: string;
  name: string;
  mimeType: string;
}

export interface IngestDeps {
  listImages(folderId: string): Promise<IngestImage[]>;
  saveThumbnail(jobId: number, photoId: number, image: IngestImage): Promise<string | null>;
}

export function createScanJob(
  db: BetterSQLite3Database<any>,
  args: { driveFolderId: string; driveFolderName: string },
): number {
  const now = Date.now();
  const res = db
    .insert(jobs)
    .values({
      driveFolderId: args.driveFolderId,
      driveFolderName: args.driveFolderName,
      status: "scanning",
      total: 0,
      processed: 0,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return Number(res.lastInsertRowid);
}

function touch(db: BetterSQLite3Database<any>, jobId: number, set: Record<string, unknown>) {
  db.update(jobs).set({ ...set, updatedAt: Date.now() }).where(eq(jobs.id, jobId)).run();
}

export async function runIngest(
  db: BetterSQLite3Database<any>,
  jobId: number,
  folderId: string,
  deps: IngestDeps,
): Promise<void> {
  try {
    const images = await deps.listImages(folderId);
    touch(db, jobId, { total: images.length });
    for (const img of images) {
      const res = db
        .insert(photos)
        .values({
          jobId,
          driveFileId: img.id,
          name: img.name,
          mimeType: img.mimeType,
          stage: "pending",
        })
        .run();
      const photoId = Number(res.lastInsertRowid);
      const thumbPath = await deps.saveThumbnail(jobId, photoId, img);
      if (thumbPath) {
        db.update(photos).set({ thumbnailPath: thumbPath }).where(eq(photos.id, photoId)).run();
      }
      db.update(jobs).set({ processed: sql`${jobs.processed} + 1`, updatedAt: Date.now() }).where(eq(jobs.id, jobId)).run();
    }
    touch(db, jobId, { status: "done" });
  } catch (err) {
    touch(db, jobId, { status: "error", errorMessage: err instanceof Error ? err.message : String(err) });
  }
}
```

- [ ] **Step 4: Re-export and subpath export**

Add to `packages/core/src/index.ts`:
```ts
export * from "./ingest.js";
```
Add to `packages/core/package.json` `exports`:
```json
    "./ingest": "./dist/ingest.js",
```

- [ ] **Step 5: Run tests + build**

Run: `npm -w @event-editor/core run test`
Expected: PASS — ingest tests green, all prior core tests still green.
Run: `npm -w @event-editor/core run build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/ingest.ts packages/core/src/index.ts packages/core/package.json packages/core/test/ingest.test.ts
git commit -m "feat(core): scan-job creation and ingest orchestrator"
```

---

### Task 5: Sorter API routes (web)

**Files:**
- Create: `packages/web/lib/sorter.ts`
- Create: `packages/web/app/api/drive/folders/route.ts`
- Create: `packages/web/app/api/sorter/jobs/route.ts`
- Create: `packages/web/app/api/sorter/jobs/[id]/route.ts`
- Test: `packages/web/test/sorter-route.test.ts`

**Interfaces:**
- Consumes: `authedDriveClient` (Task 2), `makeDriveClient` (Task 3), `createScanJob`/`runIngest` (Task 4), `getDb` (Task 2).
- Produces:
  - `lib/sorter.ts`: `startScan(db, drive, { folderId, folderName }): number` — creates the job, then fires `runIngest(...)` WITHOUT awaiting (fire-and-forget), wiring `deps.listImages` to `drive.listImages` and `deps.saveThumbnail` to write `drive.downloadThumbnail` bytes to `data/thumbs/<jobId>/<photoId>.jpg` (creating the dir, returning the relative path or null). Returns the job id immediately.
  - `GET /api/drive/folders` → `{ folders: DriveFolder[] }` or `401 { error: "not_connected" }` when no Google token.
  - `POST /api/sorter/jobs` body `{ folderId, folderName }` → `{ jobId }` (kicks off the scan) or `401 { error: "not_connected" }`.
  - `GET /api/sorter/jobs/[id]` → `{ job, photos }` (the job row + its photo rows) or `404`.

- [ ] **Step 1: Write the failing test (route logic via the lib seam)**

`packages/web/test/sorter-route.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, runMigrations, jobs } from "@event-editor/core";
import { eq } from "drizzle-orm";
import { startScan } from "../lib/sorter.js";

function freshDb() {
  const path = join(tmpdir(), `ee-srt-${Math.random().toString(36).slice(2)}.db`);
  const db = openDb(path);
  runMigrations(db);
  return db;
}

const fakeDrive = {
  async listFolders() { return [{ id: "f1", name: "A" }]; },
  async listImages() { return [{ id: "i1", name: "a.jpg", mimeType: "image/jpeg", thumbnailLink: null }]; },
  async downloadThumbnail() { return null; },
};

describe("startScan", () => {
  it("creates a job and returns its id immediately", async () => {
    const db = freshDb();
    const jobId = startScan(db, fakeDrive as any, { folderId: "f1", folderName: "A" });
    expect(typeof jobId).toBe("number");
    const job = db.select().from(jobs).where(eq(jobs.id, jobId)).all()[0];
    expect(job.driveFolderId).toBe("f1");
    // ingest runs async; give the microtask queue a tick
    await new Promise((r) => setTimeout(r, 20));
    const after = db.select().from(jobs).where(eq(jobs.id, jobId)).all()[0];
    expect(["scanning", "done"]).toContain(after.status);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/web run test sorter-route`
Expected: FAIL — `../lib/sorter.js` not found.

- [ ] **Step 3: Write `packages/web/lib/sorter.ts`**

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createScanJob, runIngest } from "@event-editor/core/ingest";
import type { openDb } from "@event-editor/core/db";
import type { DriveClient, DriveImage } from "./google/drive.js";

type Db = ReturnType<typeof openDb>;

export function startScan(
  db: Db,
  drive: DriveClient,
  args: { folderId: string; folderName: string },
): number {
  const jobId = createScanJob(db, { driveFolderId: args.folderId, driveFolderName: args.folderName });
  // fire-and-forget: ingest runs in the background, mutating the job row
  void runIngest(db, jobId, args.folderId, {
    listImages: (folderId) => drive.listImages(folderId),
    saveThumbnail: async (jId, pId, image) => {
      const bytes = await drive.downloadThumbnail(image as DriveImage);
      if (!bytes) return null;
      const dir = resolve("data/thumbs", String(jId));
      await mkdir(dir, { recursive: true });
      const rel = `data/thumbs/${jId}/${pId}.jpg`;
      await writeFile(resolve("data/thumbs", String(jId), `${pId}.jpg`), bytes);
      return rel;
    },
  });
  return jobId;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @event-editor/web run test sorter-route`
Expected: PASS.

- [ ] **Step 5: Write `app/api/drive/folders/route.ts`**

```ts
import { NextResponse } from "next/server";
import { authedDriveClient } from "@/lib/google/oauth";
import { makeDriveClient } from "@/lib/google/drive";
import { getDb } from "@/lib/db";

export async function GET() {
  const drive = await authedDriveClient(getDb());
  if (!drive) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  const folders = await makeDriveClient(drive).listFolders();
  return NextResponse.json({ folders });
}
```

- [ ] **Step 6: Write `app/api/sorter/jobs/route.ts`**

```ts
import { NextResponse } from "next/server";
import { authedDriveClient } from "@/lib/google/oauth";
import { makeDriveClient } from "@/lib/google/drive";
import { getDb } from "@/lib/db";
import { startScan } from "@/lib/sorter";

export async function POST(request: Request) {
  const { folderId, folderName } = await request.json();
  if (!folderId) return NextResponse.json({ error: "folderId required" }, { status: 400 });
  const drive = await authedDriveClient(getDb());
  if (!drive) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  const jobId = startScan(getDb(), makeDriveClient(drive), { folderId, folderName: folderName ?? "(folder)" });
  return NextResponse.json({ jobId });
}
```

- [ ] **Step 7: Write `app/api/sorter/jobs/[id]/route.ts`**

```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { jobs, photos } from "@event-editor/core/schema";
import { getDb } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = Number(id);
  const db = getDb();
  const job = db.select().from(jobs).where(eq(jobs.id, jobId)).all()[0];
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const rows = db.select().from(photos).where(eq(photos.jobId, jobId)).all();
  return NextResponse.json({ job, photos: rows });
}
```

- [ ] **Step 8: Build web to confirm routes compile**

Run: `npm -w @event-editor/web run build`
Expected: succeeds; the three new routes listed (`/api/drive/folders`, `/api/sorter/jobs`, `/api/sorter/jobs/[id]`).

- [ ] **Step 9: Commit**

```bash
git add packages/web/lib/sorter.ts packages/web/app/api/drive packages/web/app/api/sorter packages/web/test/sorter-route.test.ts
git commit -m "feat(web): sorter api routes (folders, start scan, job status)"
```

---

### Task 6: Sorter UI — connect gate, folder picker, scan progress

**Files:**
- Create: `packages/web/app/sorter/page.tsx`
- Create: `packages/web/app/sorter/SorterClient.tsx`
- Modify: `packages/web/app/settings/page.tsx` (add a Connect button for Google + reflect `?google=` query)

**Interfaces:**
- Consumes: `GET /api/drive/folders`, `POST /api/sorter/jobs`, `GET /api/sorter/jobs/[id]`; `getConnections` (Plan 1).
- Produces: a working `/sorter` flow — if Google is not connected, show a connect prompt linking to `/api/google/auth`; otherwise show a folder dropdown, a "Scan folder" button, and a live progress view that polls the job until `done`/`error`, then lists the ingested photos (name + thumbnail if present).

- [ ] **Step 1: Write the server page `app/sorter/page.tsx`**

```tsx
import { getConnections } from "@event-editor/core/settings";
import { SorterClient } from "./SorterClient";

export default function SorterPage() {
  const google = getConnections().find((c) => c.id === "google");
  return (
    <div>
      <p className="eyebrow">Photo sorter</p>
      <h1 className="mt-1 text-2xl font-semibold">Rank Drive photos for LinkedIn</h1>
      {!google?.configured ? (
        <div className="card mt-8">
          <p className="text-muted">Google credentials are not set in your environment yet.</p>
          <p className="mt-2 text-muted">Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env, then restart.</p>
        </div>
      ) : (
        <SorterClient />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write the client component `app/sorter/SorterClient.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";

interface Folder { id: string; name: string; }
interface Job { id: number; status: string; total: number; processed: number; errorMessage: string | null; }
interface Photo { id: number; name: string; thumbnailPath: string | null; }

export function SorterClient() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderId, setFolderId] = useState("");
  const [jobId, setJobId] = useState<number | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/drive/folders").then(async (r) => {
      if (r.status === 401) { setConnected(false); return; }
      setConnected(true);
      const data = await r.json();
      setFolders(data.folders ?? []);
    }).catch(() => setConnected(false));
  }, []);

  useEffect(() => {
    if (jobId == null) return;
    const tick = async () => {
      const r = await fetch(`/api/sorter/jobs/${jobId}`);
      if (!r.ok) return;
      const data = await r.json();
      setJob(data.job);
      setPhotos(data.photos ?? []);
      if (data.job.status === "done" || data.job.status === "error") return true;
      return false;
    };
    let stop = false;
    const loop = async () => { while (!stop) { if (await tick()) break; await new Promise((r) => setTimeout(r, 1000)); } };
    loop();
    return () => { stop = true; };
  }, [jobId]);

  async function scan() {
    if (!folderId) return;
    setBusy(true);
    const folder = folders.find((f) => f.id === folderId);
    const r = await fetch("/api/sorter/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId, folderName: folder?.name }),
    });
    const data = await r.json();
    setBusy(false);
    if (data.jobId) { setJobId(data.jobId); setJob(null); setPhotos([]); }
  }

  if (connected === false) {
    return (
      <div className="card mt-8">
        <p className="text-muted">Connect your Google account to read Drive folders.</p>
        <a className="btn btn-accent mt-4" href="/api/google/auth">Connect Google Drive</a>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <div className="card flex items-center gap-3">
        <select
          className="rounded-lg border border-line bg-surface px-3 py-2"
          value={folderId}
          onChange={(e) => setFolderId(e.target.value)}
        >
          <option value="">Choose a folder</option>
          {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <button className="btn btn-accent" onClick={scan} disabled={!folderId || busy}>
          {busy ? "Starting…" : "Scan folder"}
        </button>
      </div>

      {job && (
        <div className="card mt-5">
          <p className="eyebrow">Scan</p>
          {job.status === "error" ? (
            <p className="text-[color:#b42318]">Scan failed: {job.errorMessage}</p>
          ) : (
            <p className="text-muted">
              {job.status === "done" ? "Done" : "Scanning"} — {job.processed} of {job.total}
            </p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {photos.map((p) => (
              <div key={p.id} className="rounded-lg border border-line p-2">
                <div className="aspect-square overflow-hidden rounded bg-canvas" />
                <p className="mt-2 truncate text-xs text-muted" title={p.name}>{p.name}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

Note: thumbnails are stored under `data/` (not web-served). Rendering the actual image bytes is a Plan 3/5 concern (a `/api/thumb/[photoId]` route); for now the grid shows the filename under a neutral placeholder tile, which is enough to prove ingest worked.

- [ ] **Step 3: Add a Google connect affordance to `app/settings/page.tsx`**

Replace the body of `app/settings/page.tsx` with:
```tsx
import { getConnections } from "@event-editor/core/settings";

export default function Settings({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  return <SettingsBody searchParams={searchParams} />;
}

async function SettingsBody({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const { google } = await searchParams;
  const connections = getConnections();
  return (
    <div>
      <p className="eyebrow">Settings</p>
      <h1 className="mt-1 text-2xl font-semibold">Connections</h1>
      {google === "connected" && <p className="mt-3 text-success">Google connected.</p>}
      {google === "error" && <p className="mt-3 text-[color:#b42318]">Google connection failed. Try again.</p>}
      <ul className="mt-8 space-y-3">
        {connections.map((c) => (
          <li key={c.id} className="card flex items-center justify-between">
            <span>{c.label}</span>
            <span className="flex items-center gap-3">
              <span className={c.configured ? "text-success" : "text-muted"}>
                {c.configured ? "Connected" : "Not configured"}
              </span>
              {c.id === "google" && c.configured && (
                <a className="btn" href="/api/google/auth">Re-auth</a>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```
(Note: `configured` reflects whether the env CREDENTIALS exist, not whether a token is stored. The folder list endpoint is the real connected-or-not signal, surfaced in `/sorter`. Keep this simple for now.)

- [ ] **Step 4: Build web**

Run: `npm -w @event-editor/web run build`
Expected: succeeds; `/sorter` listed as a route.

- [ ] **Step 5: Manual smoke (no live Google needed for the gate)**

Run: `EE_DB_PATH="$PWD/data/app.db" npm -w @event-editor/web run dev -- --port 3001` (background), then check `/sorter` returns 200 and, with no stored Google token, the folders endpoint returns 401 so the UI shows the connect prompt:
```
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/sorter        # 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/drive/folders  # 401 (no token)
```
(If curl is blocked in your harness, fetch via the node/ctx path instead.) Kill the server after.

- [ ] **Step 6: Commit**

```bash
git add packages/web/app/sorter packages/web/app/settings/page.tsx
git commit -m "feat(web): sorter ui with connect gate, folder picker, scan progress"
```

---

## Self-Review

**Spec coverage (Plan 2 = build-order item 2, "Drive ingest"):**
- Google OAuth (callback route + token store in core) → Task 1 (store) + Task 2 (routes) ✔
- `lib/google.ts` Drive client → Task 2 (oauth) + Task 3 (drive) ✔
- `GET /api/drive/folders` → Task 5 ✔
- `POST /api/sorter/jobs` ingest writing `photos` rows + thumbnails to `data/thumbs/` → Task 4 (orchestrator) + Task 5 (route + thumbnail write) ✔
- `GET /api/sorter/jobs/:id` polling → Task 5 ✔
- `/sorter` folder-pick + progress UI → Task 6 ✔
- Empty-folder state handled (`runIngest` total 0 → done; UI shows "Done — 0 of 0") ✔
- Out of scope (correctly deferred): heuristics + Claude ranking and the review grid with scores (Plan 3); serving thumbnail bytes via a route (Plan 3/5); Canva (Plan 4).

**Placeholder scan:** No TBD/TODO; every code step has complete code; commands have expected output. The thumbnail-rendering deferral is explicitly noted, not a silent gap. ✔

**Type consistency:** `DriveClient`/`DriveImage`/`DriveFolder` defined in Task 3 and consumed by Task 5; `IngestDeps`/`IngestImage`/`createScanJob`/`runIngest` defined in Task 4 and consumed by Task 5; `TokenInput`/`StoredToken`/`saveToken`/`getToken` defined in Task 1 and consumed by Task 2; `getDb`/`authedDriveClient`/`makeDriveClient` consistent across Tasks 2, 3, 5. Job status uses only `scanning`/`done`/`error` here; photo `stage` stays `pending`. ✔

**Live-verification caveat:** Tasks 2/3/5/6 are built and unit-tested with fake clients, but a real end-to-end scan needs `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` in `.env`, a configured OAuth consent screen with the `drive.readonly` scope and `http://localhost:3000/api/google/callback` (or :3001) as an authorized redirect URI, and a browser consent. That setup is a `docs/setup/google-oauth.md` task and the user's manual step — not automatable here.
