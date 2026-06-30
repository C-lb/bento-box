# Headshot Studio — Sheet-Driven Batch (Plan 4c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render headshots for a whole group from a Google Sheet — match each row to a Drive photo, pick one renderer + one style, and produce a batch of PNGs with a reviewable results grid and a download-all zip.

**Architecture:** Pure core units (`columns`, `match`, `createBatchHeadshots`, a guarded `batch_id` migration) land and are tested first; the web layer adds a Sheets wrapper, a concurrency-capped batch runner, the routes, and a new `/studio/batch` page. The per-row engine is the existing `runHeadshotRender` (4a) and `runHeadshotCanva` (4b) — 4c builds no new rendering logic.

**Tech Stack:** Next.js 16 (App Router, nodejs runtime), Drizzle + better-sqlite3, TypeScript, Vitest, `googleapis` (`sheets_v4`), `archiver` (zip), Node `crypto`.

## Global Constraints

- Web imports core via SUBPATH exports only (`@event-editor/core/headshot`, `/match`, `/columns`, `/schema`, `/tokens`, `/db`), never the barrel.
- Relative VALUE imports in `packages/web` are EXTENSIONLESS (`./sheets`, not `./sheets.js`); Turbopack does not remap `.js`→`.ts` on resolved value imports. `import type` is exempt.
- Core test files use `.js` extensions on relative imports (`../src/index.js`) — established core convention; match the existing `headshot.test.ts`/`drift.test.ts`.
- A batch is single-renderer: entirely `local` or entirely `canva`, one `styleId` (a frame id or a brand-template id) applied to all rows.
- Google OAuth scope is widened to add `https://www.googleapis.com/auth/spreadsheets.readonly` — re-consent required; `/settings` shows a stale-scope prompt.
- No new credentials. New tuning var `EE_BATCH_CONCURRENCY` (default 3).
- No `batches` table; rows grouped by nullable `batch_id TEXT` on `headshots`.
- The project migration is idempotent `CREATE TABLE IF NOT EXISTS`, which SILENTLY no-ops on a column add to an existing table — `batch_id` therefore needs a guarded `ALTER TABLE ADD COLUMN`.
- Re-migrate the dev db with ROOT `npm run migrate` (the `-w core` form targets the wrong db file).
- Anti-vibecode house style: one accent, neutral rest, sentence-case eyebrows, no em dashes, 13px desktop base type.
- Core tests: `npm -w @event-editor/core run test`. Web tests: `npm -w @event-editor/web run test`. Web build: `npm -w @event-editor/web run build`. Build core after core changes so the web layer sees fresh subpaths: `npm -w @event-editor/core run build`.
- All tests mock Sheets/Drive/Canva — no live calls.

---

## File Structure

**Create (core):** `packages/core/src/columns.ts`, `packages/core/src/match.ts`.
**Modify (core):** `packages/core/src/schema/index.ts` (+`batch_id`), `packages/core/src/migrate.ts` (DDL +`batch_id`, guarded ALTER), `packages/core/src/headshot.ts` (optional `batchId` + `createBatchHeadshots`), `packages/core/src/index.ts` if needed for new subpath exports.
**Create (web):** `packages/web/lib/google/sheets.ts`, `packages/web/lib/batch.ts`, routes under `packages/web/app/api/studio/sheets/` and `packages/web/app/api/studio/batch/`, `packages/web/app/studio/batch/page.tsx`, `packages/web/app/studio/batch/StudioBatchClient.tsx`.
**Modify (web):** `packages/web/lib/google/oauth.ts` (+SHEETS_SCOPE), `packages/web/app/settings/page.tsx` (stale-scope check), `packages/web/package.json` (+archiver).
**Modify (docs):** `docs/setup/canva.md` or a new `docs/setup/sheets.md` note, `README.md`, `.env.example`.

Subpath exports: core uses per-module subpaths (e.g. `@event-editor/core/match`). Confirm `packages/core/package.json` `exports` maps new files the same way existing ones are mapped; if it uses an explicit map, add `./columns` and `./match` entries in the task that creates each.

---

## Task 1: Core — column auto-detect

**Files:**
- Create: `packages/core/src/columns.ts`
- Modify: `packages/core/package.json` — the `exports` map is explicit, so add `"./columns": "./dist/columns.js"`
- Test: `packages/core/test/columns.test.ts`

**Interfaces:**
- Produces: `detectColumns(header: string[]): { name: number | null; title: number | null; photo: number | null }`. Case-insensitive, trims cells. Synonyms: name ← {name, full name}, title ← {title, role, position, job title}, photo ← {photo, image, headshot, picture}. First matching column wins; null if none.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/columns.test.ts
import { describe, it, expect } from "vitest";
import { detectColumns } from "../src/columns.js";

describe("detectColumns", () => {
  it("maps exact headers case-insensitively", () => {
    expect(detectColumns(["Name", "TITLE", "Photo"])).toEqual({ name: 0, title: 1, photo: 2 });
  });
  it("uses synonyms", () => {
    expect(detectColumns(["Full Name", "Role", "Headshot"])).toEqual({ name: 0, title: 1, photo: 2 });
  });
  it("returns null for a missing field", () => {
    expect(detectColumns(["name", "department"])).toEqual({ name: 0, title: null, photo: null });
  });
  it("trims and ignores surrounding whitespace", () => {
    expect(detectColumns(["  name  ", " job title "])).toEqual({ name: 0, title: 1, photo: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/core run test -- columns`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/columns.ts
const SYNONYMS: Record<"name" | "title" | "photo", string[]> = {
  name: ["name", "full name"],
  title: ["title", "role", "position", "job title"],
  photo: ["photo", "image", "headshot", "picture"],
};

export function detectColumns(header: string[]): { name: number | null; title: number | null; photo: number | null } {
  const norm = header.map((h) => h.trim().toLowerCase());
  const find = (field: "name" | "title" | "photo") => {
    const idx = norm.findIndex((h) => SYNONYMS[field].includes(h));
    return idx === -1 ? null : idx;
  };
  return { name: find("name"), title: find("title"), photo: find("photo") };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @event-editor/core run test -- columns`
Expected: PASS.

- [ ] **Step 5: Build core + commit**

```bash
npm -w @event-editor/core run build
git add packages/core/src/columns.ts packages/core/test/columns.test.ts packages/core/package.json
git commit -m "feat(core): detectColumns for sheet header mapping"
```

---

## Task 2: Core — photo matching

**Files:**
- Create: `packages/core/src/match.ts`
- Modify: `packages/core/package.json` — explicit `exports` map, so add `"./match": "./dist/match.js"`
- Test: `packages/core/test/match.test.ts`

**Interfaces:**
- Produces:
  - `normalizeName(s: string): string` — lowercase; strip one trailing file extension; non-alphanumeric runs → single space; collapse + trim.
  - `extractDriveId(cell: string): string | null` — from `/file/d/<id>`, `?id=<id>`, or a bare id-shaped token `[-\w]{25,}`; else null.
  - `RowMatch = { status: "matched" | "ambiguous" | "unmatched"; driveFileId?: string; candidates?: string[] }`
  - `matchRow(args: { name: string; photoCell?: string; folderFiles: { id: string; name: string }[] }): RowMatch`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/match.test.ts
import { describe, it, expect } from "vitest";
import { normalizeName, extractDriveId, matchRow } from "../src/match.js";

const files = [
  { id: "fA", name: "Jane Doe.jpg" },
  { id: "fB", name: "john_smith.PNG" },
  { id: "fC", name: "Jane Doe (1).jpg" },
];

describe("normalizeName", () => {
  it("strips extension, lowercases, collapses punctuation", () => {
    expect(normalizeName("Jane_Doe.JPG")).toBe("jane doe");
    expect(normalizeName("  John–Smith.png ")).toBe("john smith");
  });
});

describe("extractDriveId", () => {
  it("pulls id from a /file/d/ url", () => {
    expect(extractDriveId("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/view")).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz12345");
  });
  it("pulls id from ?id=", () => {
    expect(extractDriveId("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz12345")).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz12345");
  });
  it("returns a bare id-shaped token", () => {
    expect(extractDriveId("1AbCdEfGhIjKlMnOpQrStUvWxYz12345")).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz12345");
  });
  it("returns null for a plain filename", () => {
    expect(extractDriveId("jane doe.jpg")).toBeNull();
  });
});

describe("matchRow", () => {
  it("resolves a drive url in the photo column", () => {
    const r = matchRow({ name: "x", photoCell: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/view", folderFiles: files });
    expect(r).toEqual({ status: "matched", driveFileId: "1AbCdEfGhIjKlMnOpQrStUvWxYz12345" });
  });
  it("matches a photo-column filename against the folder", () => {
    const r = matchRow({ name: "x", photoCell: "john smith.png", folderFiles: files });
    expect(r).toEqual({ status: "matched", driveFileId: "fB" });
  });
  it("matches by name when no photo column", () => {
    const r = matchRow({ name: "John Smith", folderFiles: files });
    expect(r).toEqual({ status: "matched", driveFileId: "fB" });
  });
  it("flags ambiguous when multiple files normalize equal", () => {
    const r = matchRow({ name: "Jane Doe", folderFiles: [{ id: "fA", name: "jane doe.jpg" }, { id: "fC", name: "Jane-Doe.png" }] });
    expect(r.status).toBe("ambiguous");
    expect(r.candidates).toEqual(["fA", "fC"]);
  });
  it("flags unmatched when nothing matches", () => {
    expect(matchRow({ name: "Nobody Here", folderFiles: files }).status).toBe("unmatched");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/core run test -- match`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/match.ts
export interface RowMatch {
  status: "matched" | "ambiguous" | "unmatched";
  driveFileId?: string;
  candidates?: string[];
}

export function normalizeName(s: string): string {
  return s
    .trim()
    .replace(/\.[a-z0-9]{1,5}$/i, "")        // strip one trailing extension
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")             // non-alphanumeric runs -> space
    .trim()
    .replace(/\s+/g, " ");
}

const FILE_D = /\/file\/d\/([-\w]{25,})/;
const ID_PARAM = /[?&]id=([-\w]{25,})/;
const BARE_ID = /^[-\w]{25,}$/;

export function extractDriveId(cell: string): string | null {
  const c = cell.trim();
  const m = FILE_D.exec(c) ?? ID_PARAM.exec(c);
  if (m) return m[1];
  if (BARE_ID.test(c)) return c;
  return null;
}

export function matchRow(args: { name: string; photoCell?: string; folderFiles: { id: string; name: string }[] }): RowMatch {
  const cell = args.photoCell?.trim();
  if (cell) {
    const id = extractDriveId(cell);
    if (id) return { status: "matched", driveFileId: id };
  }
  const needle = normalizeName(cell && cell.length ? cell : args.name);
  if (!needle) return { status: "unmatched" };
  const hits = args.folderFiles.filter((f) => normalizeName(f.name) === needle);
  if (hits.length === 1) return { status: "matched", driveFileId: hits[0].id };
  if (hits.length > 1) return { status: "ambiguous", candidates: hits.map((h) => h.id) };
  return { status: "unmatched" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @event-editor/core run test -- match`
Expected: PASS.

- [ ] **Step 5: Build core + commit**

```bash
npm -w @event-editor/core run build
git add packages/core/src/match.ts packages/core/test/match.test.ts packages/core/package.json
git commit -m "feat(core): photo matching (drive url/id/filename, normalize)"
```

---

## Task 3: Core — `batch_id` migration (guarded ALTER)

**Files:**
- Modify: `packages/core/src/schema/index.ts` (add `batchId`), `packages/core/src/migrate.ts` (DDL + guarded ALTER)
- Test: `packages/core/test/batch-migration.test.ts` (new); existing `test/drift.test.ts` stays green unchanged

**Interfaces:**
- Produces: `headshots.batchId` (`batch_id TEXT`, nullable) in the Drizzle schema; `addColumnIfMissing(db, table: string, column: string, ddlType: string): void` exported from `migrate.ts`; `runMigrations` now adds `batch_id` to existing `headshots` tables.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/batch-migration.test.ts
import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { openDb, runMigrations } from "../src/index.js";
import { addColumnIfMissing } from "../src/migrate.js";

function cols(db: ReturnType<typeof openDb>, table: string): string[] {
  const rows = db.all(sql.raw(`PRAGMA table_info(${table})`)) as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

describe("batch_id migration", () => {
  it("fresh db has batch_id on headshots", () => {
    const db = openDb(join(tmpdir(), `ee-bm-${Math.random().toString(36).slice(2)}.db`));
    runMigrations(db);
    expect(cols(db, "headshots")).toContain("batch_id");
  });

  it("addColumnIfMissing adds to a pre-existing table and is idempotent", () => {
    const db = openDb(join(tmpdir(), `ee-bm-${Math.random().toString(36).slice(2)}.db`));
    // simulate a 4b-era headshots table without batch_id
    db.run(sql.raw("CREATE TABLE headshots (id INTEGER PRIMARY KEY, renderer TEXT)"));
    addColumnIfMissing(db, "headshots", "batch_id", "TEXT");
    expect(cols(db, "headshots")).toContain("batch_id");
    // second call is a no-op, no throw
    addColumnIfMissing(db, "headshots", "batch_id", "TEXT");
    expect(cols(db, "headshots").filter((c) => c === "batch_id")).toHaveLength(1);
  });

  it("runMigrations is idempotent on batch_id", () => {
    const db = openDb(join(tmpdir(), `ee-bm-${Math.random().toString(36).slice(2)}.db`));
    runMigrations(db);
    runMigrations(db);
    expect(cols(db, "headshots").filter((c) => c === "batch_id")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/core run test -- batch-migration`
Expected: FAIL — `addColumnIfMissing` not exported / fresh db lacks `batch_id`.

- [ ] **Step 3: Add `batchId` to the Drizzle schema**

In `packages/core/src/schema/index.ts`, in the `headshots` table after `exportUrl`/before the timestamps (match the column order to the DDL):

```ts
  batchId: text("batch_id"),
```

- [ ] **Step 4: Add `batch_id` to the DDL and the guarded ALTER in `migrate.ts`**

In the `headshots` CREATE block inside `DDL`, add `batch_id TEXT,` immediately before `created_at`:

```
    export_url TEXT,
    error_message TEXT,
    batch_id TEXT,
    created_at INTEGER NOT NULL DEFAULT 0,
```

Add the helper and call it from `runMigrations` (after `migrateHeadshots`, so it also covers a freshly-rebuilt legacy table):

```ts
export function addColumnIfMissing(db: BetterSQLite3Database<any>, table: string, column: string, ddlType: string): void {
  const info = db.all(sql.raw(`PRAGMA table_info(${table})`)) as Array<{ name: string }>;
  if (!info.some((r) => r.name === column)) {
    db.run(sql.raw(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddlType}`));
  }
}

export function runMigrations(db: BetterSQLite3Database<any>): void {
  for (const stmt of DDL) {
    db.run(sql.raw(stmt));
  }
  migrateHeadshots(db);
  addColumnIfMissing(db, "headshots", "batch_id", "TEXT");
}
```

- [ ] **Step 5: Run tests to verify they pass (incl. drift)**

Run: `npm -w @event-editor/core run test -- batch-migration drift`
Expected: PASS — `batch-migration` green; `drift` still green because schema + DDL both now carry `batch_id`.

- [ ] **Step 6: Re-migrate the dev db, build core, commit**

```bash
npm run migrate            # ROOT form — sets EE_DB_PATH to $PWD/data/app.db
npm -w @event-editor/core run build
git add packages/core/src/schema/index.ts packages/core/src/migrate.ts packages/core/test/batch-migration.test.ts
git commit -m "feat(core): batch_id column on headshots via guarded ALTER"
```

---

## Task 4: Core — `createBatchHeadshots`

**Files:**
- Modify: `packages/core/src/headshot.ts` (optional `batchId` on both create args + `createBatchHeadshots`)
- Test: `packages/core/test/batch-create.test.ts`

**Interfaces:**
- Consumes: existing `createHeadshot`, `createCanvaHeadshot`, `headshots` schema.
- Produces:
  - `CreateHeadshotArgs` and `CreateCanvaHeadshotArgs` each gain optional `batchId?: string` (set on insert; default null — existing callers unaffected).
  - `createBatchHeadshots(db, args: { batchId: string; renderer: "local" | "canva"; styleId: string; rows: { driveFileId: string; nameText: string; titleText: string }[] }): number[]` — one row per entry via the matching create helper, all tagged `batchId`; returns ids in row order.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/batch-create.test.ts
import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openDb, runMigrations, headshots } from "../src/index.js";
import { createBatchHeadshots } from "../src/headshot.js";

function freshDb() {
  const db = openDb(join(tmpdir(), `ee-bc-${Math.random().toString(36).slice(2)}.db`));
  runMigrations(db);
  return db;
}

describe("createBatchHeadshots", () => {
  it("creates canva rows tagged with the batch id", () => {
    const db = freshDb();
    const ids = createBatchHeadshots(db, {
      batchId: "b1", renderer: "canva", styleId: "tmpl1",
      rows: [
        { driveFileId: "f1", nameText: "Ada", titleText: "CTO" },
        { driveFileId: "f2", nameText: "Linus", titleText: "Eng" },
      ],
    });
    expect(ids).toHaveLength(2);
    const rows = db.select().from(headshots).all();
    expect(rows.every((r) => r.batchId === "b1")).toBe(true);
    expect(rows.every((r) => r.renderer === "canva")).toBe(true);
    expect(rows.every((r) => r.canvaTemplateId === "tmpl1")).toBe(true);
    expect(rows.every((r) => r.status === "autofilling")).toBe(true);
    expect(rows.map((r) => r.nameText).sort()).toEqual(["Ada", "Linus"]);
  });

  it("creates local rows with the frame as template_id", () => {
    const db = freshDb();
    const ids = createBatchHeadshots(db, {
      batchId: "b2", renderer: "local", styleId: "circle",
      rows: [{ driveFileId: "f3", nameText: "Grace", titleText: "Adm" }],
    });
    const r = db.select().from(headshots).where(eq(headshots.id, ids[0])).all()[0];
    expect(r.renderer).toBe("local");
    expect(r.templateId).toBe("circle");
    expect(r.canvaTemplateId).toBeNull();
    expect(r.status).toBe("rendering");
    expect(r.batchId).toBe("b2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/core run test -- batch-create`
Expected: FAIL — `createBatchHeadshots` not exported.

- [ ] **Step 3: Add optional `batchId` to the create args + `createBatchHeadshots`**

In `packages/core/src/headshot.ts`:

In `CreateHeadshotArgs` add `batchId?: string;`; in `createHeadshot`'s `.values({...})` add `batchId: args.batchId ?? null,`.
In `CreateCanvaHeadshotArgs` add `batchId?: string;`; in `createCanvaHeadshot`'s `.values({...})` add `batchId: args.batchId ?? null,`.

Then append:

```ts
export function createBatchHeadshots(
  db: BetterSQLite3Database<any>,
  args: {
    batchId: string;
    renderer: "local" | "canva";
    styleId: string;
    rows: { driveFileId: string; nameText: string; titleText: string }[];
  },
): number[] {
  return args.rows.map((row) =>
    args.renderer === "canva"
      ? createCanvaHeadshot(db, {
          driveFileId: row.driveFileId,
          canvaTemplateId: args.styleId,
          nameText: row.nameText,
          titleText: row.titleText,
          batchId: args.batchId,
        })
      : createHeadshot(db, {
          driveFileId: row.driveFileId,
          frameId: args.styleId,
          nameText: row.nameText,
          titleText: row.titleText,
          batchId: args.batchId,
        }),
  );
}
```

- [ ] **Step 4: Run test to verify it passes (and existing headshot tests)**

Run: `npm -w @event-editor/core run test -- batch-create headshot`
Expected: PASS — new test green; existing `headshot`/`headshot-canva` tests still green (optional `batchId` defaults to null).

- [ ] **Step 5: Build core + commit**

```bash
npm -w @event-editor/core run build
git add packages/core/src/headshot.ts packages/core/test/batch-create.test.ts
git commit -m "feat(core): createBatchHeadshots + optional batchId on create args"
```

---

## Task 5: Web — widen Google scope to Sheets

**Files:**
- Modify: `packages/web/lib/google/oauth.ts` (add `SHEETS_SCOPE`), `packages/web/app/settings/page.tsx` (stale-scope check includes Sheets)
- Test: `packages/web/test/google-scope.test.ts`

**Interfaces:**
- Produces: `SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly"` exported from `oauth.ts`; included in `buildAuthUrl`'s scope list.

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/test/google-scope.test.ts
import { describe, it, expect } from "vitest";
import { makeOAuthClient, buildAuthUrl, SHEETS_SCOPE } from "../lib/google/oauth";

describe("google scopes", () => {
  it("auth url requests the sheets readonly scope", () => {
    process.env.GOOGLE_CLIENT_ID = "cid";
    process.env.GOOGLE_CLIENT_SECRET = "sec";
    const url = buildAuthUrl(makeOAuthClient());
    expect(SHEETS_SCOPE).toBe("https://www.googleapis.com/auth/spreadsheets.readonly");
    expect(decodeURIComponent(url)).toContain(SHEETS_SCOPE);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/web run test -- google-scope`
Expected: FAIL — `SHEETS_SCOPE` not exported / not in the url.

- [ ] **Step 3: Add the scope**

In `packages/web/lib/google/oauth.ts`, beside `DRIVE_SCOPE`/`DRIVE_FILE_SCOPE`:

```ts
export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
```

In `buildAuthUrl`, add it to the `scope` array:

```ts
    scope: [DRIVE_SCOPE, DRIVE_FILE_SCOPE, SHEETS_SCOPE],
```

- [ ] **Step 4: Update the settings stale-scope check**

In `packages/web/app/settings/page.tsx`, where `needsReauth` is computed for Google, also require the sheets scope (import `SHEETS_SCOPE`):

```ts
  const scope = googleToken?.scope ?? "";
  const needsReauth = googleToken !== null && (!scope.includes(DRIVE_FILE_SCOPE) || !scope.includes(SHEETS_SCOPE));
```

Update the re-auth hint copy to mention batch/sheets, e.g. `Write + Sheets access needed for the transcriber and batch headshots. Re-auth below.` (sentence case, no em dashes).

- [ ] **Step 5: Run test + build**

Run: `npm -w @event-editor/web run test -- google-scope && npm -w @event-editor/web run build`
Expected: PASS, build clean.

- [ ] **Step 6: Commit**

```bash
git add packages/web/lib/google/oauth.ts packages/web/app/settings/page.tsx packages/web/test/google-scope.test.ts
git commit -m "feat(web): widen Google OAuth scope to sheets.readonly"
```

---

## Task 6: Web — Sheets wrapper

**Files:**
- Create: `packages/web/lib/google/sheets.ts`
- Test: `packages/web/test/sheets.test.ts`

**Interfaces:**
- Consumes: `getToken`/`saveToken` (`@event-editor/core/tokens`), `makeOAuthClient` (`./oauth`), `google` (`googleapis`).
- Produces:
  - `extractSpreadsheetId(input: string): string` — id from a docs URL or a bare id.
  - `authedSheetsClient(db): Promise<sheets_v4.Sheets | null>` — mirrors `authedDriveClient` (null if Google not connected; token refresh persisted via the OAuth2 `tokens` event).
  - `listTabs(sheets, spreadsheetId): Promise<string[]>`
  - `readValues(sheets, spreadsheetId, tab): Promise<{ header: string[]; rows: string[][] }>`

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/test/sheets.test.ts
import { describe, it, expect, vi } from "vitest";
import { extractSpreadsheetId, listTabs, readValues } from "../lib/google/sheets";

describe("extractSpreadsheetId", () => {
  it("pulls the id from a docs url", () => {
    expect(extractSpreadsheetId("https://docs.google.com/spreadsheets/d/1AbC_def-123/edit#gid=0")).toBe("1AbC_def-123");
  });
  it("returns a bare id unchanged", () => {
    expect(extractSpreadsheetId("1AbC_def-123")).toBe("1AbC_def-123");
  });
});

describe("listTabs / readValues", () => {
  it("lists tab titles", async () => {
    const sheets = { spreadsheets: { get: vi.fn(async () => ({ data: { sheets: [{ properties: { title: "Roster" } }, { properties: { title: "Sheet2" } }] } })) } } as any;
    expect(await listTabs(sheets, "id1")).toEqual(["Roster", "Sheet2"]);
  });
  it("splits header from rows", async () => {
    const sheets = { spreadsheets: { values: { get: vi.fn(async () => ({ data: { values: [["Name", "Title"], ["Ada", "CTO"], ["Linus", "Eng"]] } })) } } } as any;
    expect(await readValues(sheets, "id1", "Roster")).toEqual({ header: ["Name", "Title"], rows: [["Ada", "CTO"], ["Linus", "Eng"]] });
  });
  it("handles an empty sheet", async () => {
    const sheets = { spreadsheets: { values: { get: vi.fn(async () => ({ data: {} })) } } } as any;
    expect(await readValues(sheets, "id1", "Roster")).toEqual({ header: [], rows: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/web run test -- sheets`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/web/lib/google/sheets.ts
import { google } from "googleapis";
import type { sheets_v4 } from "googleapis";
import { getToken, saveToken } from "@event-editor/core/tokens";
import { makeOAuthClient } from "./oauth";
import type { openDb } from "@event-editor/core/db";

const URL_ID = /\/spreadsheets\/d\/([-\w]+)/;

export function extractSpreadsheetId(input: string): string {
  const m = URL_ID.exec(input.trim());
  return m ? m[1] : input.trim();
}

export async function authedSheetsClient(db: ReturnType<typeof openDb>): Promise<sheets_v4.Sheets | null> {
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
  return google.sheets({ version: "v4", auth: client });
}

export async function listTabs(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<string[]> {
  const res = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
  return (res.data.sheets ?? []).map((s) => s.properties?.title ?? "").filter(Boolean);
}

export async function readValues(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tab: string,
): Promise<{ header: string[]; rows: string[][] }> {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: tab });
  const values = (res.data.values ?? []) as string[][];
  if (values.length === 0) return { header: [], rows: [] };
  return { header: values[0].map((c) => String(c ?? "")), rows: values.slice(1).map((r) => r.map((c) => String(c ?? ""))) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @event-editor/web run test -- sheets`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/google/sheets.ts packages/web/test/sheets.test.ts
git commit -m "feat(web): Google Sheets wrapper (tabs, values, id extract)"
```

---

## Task 7: Web — sheets routes

**Files:**
- Create: `packages/web/app/api/studio/sheets/tabs/route.ts`, `packages/web/app/api/studio/sheets/values/route.ts`
- Test: none (integration glue; build-verified)

**Interfaces:**
- Consumes: `authedSheetsClient`, `extractSpreadsheetId`, `listTabs`, `readValues` (Task 6); `getDb`.

- [ ] **Step 1: Implement the tabs route**

```ts
// packages/web/app/api/studio/sheets/tabs/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authedSheetsClient, extractSpreadsheetId, listTabs } from "@/lib/google/sheets";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("spreadsheetId");
  if (!raw) return NextResponse.json({ error: "spreadsheetId required" }, { status: 400 });
  const sheets = await authedSheetsClient(getDb());
  if (!sheets) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  try {
    const tabs = await listTabs(sheets, extractSpreadsheetId(raw));
    return NextResponse.json({ tabs });
  } catch (e: any) {
    const status = e?.code === 403 || e?.response?.status === 403 ? 403 : 502;
    return NextResponse.json({ error: status === 403 ? "scope_or_access" : String(e?.message ?? e) }, { status });
  }
}
```

- [ ] **Step 2: Implement the values route**

```ts
// packages/web/app/api/studio/sheets/values/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authedSheetsClient, extractSpreadsheetId, readValues } from "@/lib/google/sheets";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const raw = params.get("spreadsheetId");
  const tab = params.get("tab");
  if (!raw || !tab) return NextResponse.json({ error: "spreadsheetId and tab required" }, { status: 400 });
  const sheets = await authedSheetsClient(getDb());
  if (!sheets) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  try {
    const data = await readValues(sheets, extractSpreadsheetId(raw), tab);
    return NextResponse.json(data);
  } catch (e: any) {
    const status = e?.code === 403 || e?.response?.status === 403 ? 403 : 502;
    return NextResponse.json({ error: status === 403 ? "scope_or_access" : String(e?.message ?? e) }, { status });
  }
}
```

- [ ] **Step 3: Build to verify both routes typecheck**

Run: `npm -w @event-editor/web run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/web/app/api/studio/sheets/
git commit -m "feat(web): sheets tabs + values routes"
```

---

## Task 8: Web — batch runner + match helper

**Files:**
- Create: `packages/web/lib/batch.ts`
- Test: `packages/web/test/batch-runner.test.ts`

**Interfaces:**
- Consumes: `startHeadshot`, `startHeadshotCanva` (`@/lib/studio`); `matchRow` (`@event-editor/core/match`); `DriveClient`.
- Produces:
  - `BATCH_CONCURRENCY = Number(process.env.EE_BATCH_CONCURRENCY) || 3`
  - `runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void>` — promise pool; a worker that throws does not stop the others.
  - `matchSheetRows(args: { header: string[]; rows: string[][]; mapping: { name: number; title: number | null; photo: number | null }; folderFiles: { id: string; name: string }[] }): { index: number; name: string; title: string; match: RowMatch }[]`
  - `runBatch(db, drive: DriveClient, renderer: "local" | "canva", ids: number[]): void` — fire each row's engine through the pool.

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/test/batch-runner.test.ts
import { describe, it, expect, vi } from "vitest";
import { runWithConcurrency, matchSheetRows } from "../lib/batch";

describe("runWithConcurrency", () => {
  it("runs all items with a bounded number in flight", async () => {
    let inFlight = 0, maxSeen = 0;
    const order: number[] = [];
    const items = [1, 2, 3, 4, 5];
    await runWithConcurrency(items, 2, async (n) => {
      inFlight++; maxSeen = Math.max(maxSeen, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      order.push(n); inFlight--;
    });
    expect(maxSeen).toBeLessThanOrEqual(2);
    expect(order.sort()).toEqual(items);
  });

  it("a throwing worker does not stop the rest", async () => {
    const done: number[] = [];
    await runWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("boom");
      done.push(n);
    });
    expect(done.sort()).toEqual([1, 3]);
  });
});

describe("matchSheetRows", () => {
  it("maps each data row to name/title + a match", () => {
    const out = matchSheetRows({
      header: ["Name", "Title", "Photo"],
      rows: [["Ada", "CTO", "ada.jpg"], ["Nobody", "X", "missing.jpg"]],
      mapping: { name: 0, title: 1, photo: 2 },
      folderFiles: [{ id: "f1", name: "Ada.JPG" }],
    });
    expect(out[0]).toEqual({ index: 0, name: "Ada", title: "CTO", match: { status: "matched", driveFileId: "f1" } });
    expect(out[1].match.status).toBe("unmatched");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/web run test -- batch-runner`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/web/lib/batch.ts
import { matchRow, type RowMatch } from "@event-editor/core/match";
import type { openDb } from "@event-editor/core/db";
import type { DriveClient } from "./google/drive";
import { startHeadshot, startHeadshotCanva } from "./studio";

type Db = ReturnType<typeof openDb>;

export const BATCH_CONCURRENCY = Number(process.env.EE_BATCH_CONCURRENCY) || 3;

export async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items.entries()];
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      try {
        await worker(next[1]);
      } catch {
        // per-item failure is isolated; the row records its own error
      }
    }
  });
  await Promise.all(runners);
}

export function matchSheetRows(args: {
  header: string[];
  rows: string[][];
  mapping: { name: number; title: number | null; photo: number | null };
  folderFiles: { id: string; name: string }[];
}): { index: number; name: string; title: string; match: RowMatch }[] {
  const { mapping, folderFiles } = args;
  return args.rows.map((row, index) => {
    const name = (row[mapping.name] ?? "").trim();
    const title = mapping.title != null ? (row[mapping.title] ?? "").trim() : "";
    const photoCell = mapping.photo != null ? (row[mapping.photo] ?? "").trim() : undefined;
    return { index, name, title, match: matchRow({ name, photoCell, folderFiles }) };
  });
}

export function runBatch(db: Db, drive: DriveClient, renderer: "local" | "canva", ids: number[]): void {
  void runWithConcurrency(ids, BATCH_CONCURRENCY, async (id) => {
    if (renderer === "canva") startHeadshotCanva(db, drive, id);
    else startHeadshot(db, drive, id);
  });
}
```

> Note: `startHeadshot`/`startHeadshotCanva` are fire-and-forget (`void runHeadshot*`). The pool here bounds how many are *kicked off* in a tick; each render then proceeds independently and the client polls. This keeps a 30-row batch from launching 30 Canva pipelines simultaneously. The worker returns immediately after kick-off, so the concurrency cap is a launch throttle, not a completion gate — acceptable for a single-user tool. If true completion-bounding is wanted later, `runHeadshot*` would need an awaitable variant (out of scope here).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @event-editor/web run test -- batch-runner`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/batch.ts packages/web/test/batch-runner.test.ts
git commit -m "feat(web): batch runner (concurrency pool) + matchSheetRows"
```

---

## Task 9: Web — batch match + create routes

**Files:**
- Create: `packages/web/app/api/studio/batch/match/route.ts`, `packages/web/app/api/studio/batch/route.ts`
- Test: none (integration glue; the matcher + create are unit-tested in Tasks 2/4/8)

**Interfaces:**
- Consumes: `authedSheetsClient`/`extractSpreadsheetId`/`readValues` (Task 6), `authedDriveClient`/`makeDriveClient` (existing), `matchSheetRows`/`runBatch` (Task 8), `createBatchHeadshots` (Task 4), `getFrame` (`@event-editor/core/frames`), `randomBytes` (node:crypto).

- [ ] **Step 1: Implement the match route**

```ts
// packages/web/app/api/studio/batch/match/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authedSheetsClient, extractSpreadsheetId, readValues } from "@/lib/google/sheets";
import { authedDriveClient, makeDriveClient } from "@/lib/google/drive-helpers";
import { matchSheetRows } from "@/lib/batch";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { spreadsheetId, tab, mapping, folderId } = body ?? {};
  if (!spreadsheetId || !tab || !mapping || mapping.name == null || !folderId) {
    return NextResponse.json({ error: "spreadsheetId, tab, mapping.name, folderId required" }, { status: 400 });
  }
  const db = getDb();
  const sheets = await authedSheetsClient(db);
  const drive = await authedDriveClient(db);
  if (!sheets || !drive) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  try {
    const { header, rows } = await readValues(sheets, extractSpreadsheetId(spreadsheetId), tab);
    const folderFiles = (await makeDriveClient(drive).listImages(folderId)).map((i) => ({ id: i.id, name: i.name }));
    return NextResponse.json({ rows: matchSheetRows({ header, rows, mapping, folderFiles }) });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 502 });
  }
}
```

> Import note: the existing project exposes `authedDriveClient` from `@/lib/google/oauth` and `makeDriveClient` from `@/lib/google/drive`. Use those exact paths (the `@/lib/google/drive-helpers` above is a placeholder — replace with the real modules: `import { authedDriveClient } from "@/lib/google/oauth"` and `import { makeDriveClient } from "@/lib/google/drive"`).

- [ ] **Step 2: Implement the create route**

```ts
// packages/web/app/api/studio/batch/route.ts
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/db";
import { authedDriveClient } from "@/lib/google/oauth";
import { makeDriveClient } from "@/lib/google/drive";
import { createBatchHeadshots } from "@event-editor/core/headshot";
import { getFrame } from "@event-editor/core/frames";
import { runBatch } from "@/lib/batch";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const renderer = body?.renderer === "canva" ? "canva" : "local";
  const styleId = body?.styleId;
  const rows = Array.isArray(body?.rows) ? body.rows : null;
  if (!styleId || !rows || rows.length === 0) {
    return NextResponse.json({ error: "styleId and a non-empty rows[] required" }, { status: 400 });
  }
  if (renderer === "local" && !getFrame(styleId)) {
    return NextResponse.json({ error: "unknown frame" }, { status: 400 });
  }
  const clean = rows
    .filter((r: any) => r?.driveFileId)
    .map((r: any) => ({ driveFileId: String(r.driveFileId), nameText: String(r.nameText ?? ""), titleText: String(r.titleText ?? "") }));
  if (clean.length === 0) return NextResponse.json({ error: "no rows with a resolved photo" }, { status: 400 });

  const db = getDb();
  const drive = await authedDriveClient(db);
  if (!drive) return NextResponse.json({ error: "not_connected" }, { status: 401 });

  const batchId = randomBytes(8).toString("hex");
  const ids = createBatchHeadshots(db, { batchId, renderer, styleId, rows: clean });
  runBatch(db, makeDriveClient(drive), renderer, ids);
  return NextResponse.json({ batchId, ids });
}
```

- [ ] **Step 3: Build to verify routes typecheck**

Run: `npm -w @event-editor/web run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/web/app/api/studio/batch/match/ packages/web/app/api/studio/batch/route.ts
git commit -m "feat(web): batch match + create routes"
```

---

## Task 10: Web — batch poll + per-row retry routes

**Files:**
- Create: `packages/web/app/api/studio/batch/[batchId]/route.ts`, `packages/web/app/api/studio/batch/[batchId]/retry/[id]/route.ts`
- Test: none (integration glue)

**Interfaces:**
- Consumes: `headshots` schema, `eq`, `toHeadshotDto`, `getDb`, `authedDriveClient`/`makeDriveClient`, `startHeadshot`/`startHeadshotCanva`.

- [ ] **Step 1: Implement the poll route**

```ts
// packages/web/app/api/studio/batch/[batchId]/route.ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { headshots } from "@event-editor/core/schema";
import { getDb } from "@/lib/db";
import { toHeadshotDto } from "@/lib/headshot-dto";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  const rows = getDb().select().from(headshots).where(eq(headshots.batchId, batchId)).all();
  return NextResponse.json({ batchId, headshots: rows.map(toHeadshotDto) });
}
```

- [ ] **Step 2: Implement the per-row retry route**

```ts
// packages/web/app/api/studio/batch/[batchId]/retry/[id]/route.ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { headshots } from "@event-editor/core/schema";
import { getDb } from "@/lib/db";
import { authedDriveClient } from "@/lib/google/oauth";
import { makeDriveClient } from "@/lib/google/drive";
import { startHeadshot, startHeadshotCanva } from "@/lib/studio";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ batchId: string; id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const row = db.select().from(headshots).where(eq(headshots.id, Number(id))).all()[0];
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const drive = await authedDriveClient(db);
  if (!drive) return NextResponse.json({ error: "not_connected" }, { status: 401 });

  // reset to the renderer's initial status so the engine re-runs cleanly
  db.update(headshots)
    .set({ status: row.renderer === "canva" ? "autofilling" : "rendering", errorMessage: null, updatedAt: Date.now() })
    .where(eq(headshots.id, row.id))
    .run();
  if (row.renderer === "canva") startHeadshotCanva(db, makeDriveClient(drive), row.id);
  else startHeadshot(db, makeDriveClient(drive), row.id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Build to verify routes typecheck**

Run: `npm -w @event-editor/web run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/web/app/api/studio/batch/\[batchId\]/route.ts packages/web/app/api/studio/batch/\[batchId\]/retry/
git commit -m "feat(web): batch poll + per-row retry routes"
```

---

## Task 11: Web — download-all zip

**Files:**
- Modify: `packages/web/package.json` (add `archiver` + `@types/archiver`)
- Create: `packages/web/app/api/studio/batch/[batchId]/zip/route.ts`
- Test: none (streams a binary; build-verified)

**Interfaces:**
- Consumes: `headshots` schema, `getDb`, `HEADSHOT_DIR` (`@/lib/studio`), `archiver`.

- [ ] **Step 1: Add the dependency**

```bash
npm i -w @event-editor/web archiver
npm i -D -w @event-editor/web @types/archiver
```

- [ ] **Step 2: Implement the zip route**

```ts
// packages/web/app/api/studio/batch/[batchId]/zip/route.ts
import { eq } from "drizzle-orm";
import { resolve } from "node:path";
import { createReadStream, existsSync } from "node:fs";
import archiver from "archiver";
import { headshots } from "@event-editor/core/schema";
import { getDb } from "@/lib/db";
import { HEADSHOT_DIR } from "@/lib/studio";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  const rows = getDb().select().from(headshots).where(eq(headshots.batchId, batchId)).all()
    .filter((r) => r.status === "done" && r.outputPath);

  const archive = archiver("zip", { zlib: { level: 9 } });
  const used = new Set<string>();
  for (const r of rows) {
    const abs = resolve(r.outputPath!);
    if (!existsSync(abs)) continue;
    const base = (r.nameText?.trim() || `headshot-${r.id}`).replace(/[^\w .-]+/g, "_");
    let fname = `${base}.png`;
    let n = 1;
    while (used.has(fname)) fname = `${base} (${n++}).png`;
    used.add(fname);
    archive.append(createReadStream(abs), { name: fname });
  }
  archive.finalize();

  const stream = archive as unknown as ReadableStream;
  return new Response(stream as any, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="headshots-${batchId}.zip"`,
    },
  });
}
```

> If passing the Node stream directly to `Response` fails the build under the Next runtime, wrap it: `const body = new ReadableStream({ start(c){ archive.on("data", d => c.enqueue(d)); archive.on("end", () => c.close()); archive.on("error", e => c.error(e)); } }); archive.finalize();` and return `new Response(body, {...})`. Use whichever the build accepts; verify in Step 3.

- [ ] **Step 3: Build to verify it typechecks + bundles**

Run: `npm -w @event-editor/web run build`
Expected: clean. If the stream cast fails, apply the `ReadableStream` wrapper from the note and rebuild.

- [ ] **Step 4: Commit**

```bash
git add packages/web/package.json packages/web/package-lock.json packages/web/app/api/studio/batch/\[batchId\]/zip/
git commit -m "feat(web): download-all zip route for a batch"
```

---

## Task 12: Web — batch page: sheet load, mapping, match table

**Files:**
- Create: `packages/web/app/studio/batch/page.tsx`, `packages/web/app/studio/batch/StudioBatchClient.tsx`
- Test: none (client component; build-verified)

**Interfaces:**
- Consumes: `/api/drive/folders`, `/api/studio/sheets/tabs`, `/api/studio/sheets/values`, `/api/studio/batch/match`, `/api/studio/templates`, `FRAME_LIST` (`@event-editor/core/frames`).
- Produces (for Task 13): a `StudioBatchClient` holding state `spreadsheetId`, `tab`, `header`, `mapping {name,title,photo}`, `renderer`, `styleId`, `folderId`, `matched` (the match-route rows), `selected` (Set of indices). Task 13 adds the generate + results half.

- [ ] **Step 1: Server page**

```tsx
// packages/web/app/studio/batch/page.tsx
import { StudioBatchClient } from "./StudioBatchClient";

export default function BatchPage() {
  return (
    <div>
      <p className="eyebrow">Headshot studio</p>
      <h1 className="mt-1 text-2xl font-semibold">Batch from a sheet</h1>
      <StudioBatchClient />
    </div>
  );
}
```

- [ ] **Step 2: Client — setup, sheet load, mapping, renderer/style, folder, match table**

Create `StudioBatchClient.tsx` as a `"use client"` component. Build it in the project's stepped, eyebrow-labelled idiom (read `app/studio/StudioClient.tsx` for the exact class names: `eyebrow`, the select classes `rounded-lg border border-line bg-surface px-3 py-2`, `btn`, `bg-accent text-white` for active toggles). It must:

- Load Drive folders on mount from `/api/drive/folders` (401 → show a Google connect gate linking `/settings`).
- A text input for the Sheet URL/id + a "Load tabs" button → `GET /api/studio/sheets/tabs?spreadsheetId=`; a 401 shows the Google gate, a 403 shows a "re-auth for Sheets access" prompt linking `/settings/api/google/auth` (use the existing `/api/google/auth` link).
- A tab `<select>`; on choose → `GET /api/studio/sheets/values?...` → store `header` + `rows`; seed `mapping` from `detectColumns(header)` — call it client-side by importing `detectColumns` from `@event-editor/core/columns` (pure, safe in a client bundle).
- Three mapping `<select>`s (name/title/photo) listing the header columns (title/photo include a "none" option); name is required.
- A renderer toggle Local|Canva (mirror `StudioClient`'s toggle). Local → a frame `<select>` from `FRAME_LIST`; Canva → load `/api/studio/templates` (401 → Canva connect gate) into a template `<select>`. Selected value drives `styleId`.
- A Drive photo-folder `<select>` from the loaded folders → `folderId`.
- A "Match rows" button (enabled when `spreadsheetId`, `tab`, `mapping.name != null`, and `folderId` are set) → `POST /api/studio/batch/match` with `{spreadsheetId, tab, mapping, folderId}` → store `matched`.
- A match table: one row per `matched` entry showing name, title, and a status chip (matched green / ambiguous yellow / unmatched muted via the existing semantic colour classes). A checkbox per row, disabled and unchecked when `match.status !== "matched"` (ambiguous/unmatched are not selectable in this task; ambiguous candidate-picking is a follow-up). A "select all matched" control. Track `selected` as a Set of row indices.

Keep the file focused; the generate + results grid come in Task 13. Use anti-vibecode style: sentence-case eyebrows, no em dashes, one accent.

- [ ] **Step 3: Build to verify it typechecks**

Run: `npm -w @event-editor/web run build`
Expected: clean (the `/studio/batch` route appears in the output).

- [ ] **Step 4: Commit**

```bash
git add packages/web/app/studio/batch/
git commit -m "feat(web): batch page - sheet load, column mapping, match table"
```

---

## Task 13: Web — batch page: generate + results grid + download all

**Files:**
- Modify: `packages/web/app/studio/batch/StudioBatchClient.tsx`
- Modify: `packages/web/components/Nav.tsx` (add a "Batch" destination if the Nav lists studio tools)
- Test: none (client component; build-verified)

**Interfaces:**
- Consumes: `POST /api/studio/batch`, `GET /api/studio/batch/[batchId]`, `POST /api/studio/batch/[batchId]/retry/[id]`, `GET /api/studio/batch/[batchId]/zip`, `StatusBadge`, `headshotStatusView`.

- [ ] **Step 1: Add generate + polling + results grid**

In `StudioBatchClient.tsx` add:
- A "Generate N headshots" button (N = `selected.size`), disabled unless `selected.size > 0` and `styleId` is set, with a disabled-reason line. On click → `POST /api/studio/batch` with `{ renderer, styleId, rows: selectedMatchedRows.map(r => ({ driveFileId: r.match.driveFileId, nameText: r.name, titleText: r.title })) }` → store the returned `batchId`.
- A poll effect keyed on `batchId`: while set, `GET /api/studio/batch/[batchId]` every 1500ms, store `batchHeadshots` (the DTO array); stop when every row is `done` or `error`.
- A results grid: one card per batch row showing the thumbnail (`imageUrl` once done), the person's name, a `StatusBadge` from `headshotStatusView(row.status)`, and on `error` the `errorMessage` + a "Retry" button → `POST /api/studio/batch/[batchId]/retry/[id]` (the poll picks up the change).
- A "Download all" button shown once at least one row is `done` → links/navigates to `GET /api/studio/batch/[batchId]/zip`.
- A "Start over" control that clears `batchId`, `matched`, `selected` (keeps `spreadsheetId`/`renderer` so the user can re-run).

- [ ] **Step 2: Add the Nav destination (if applicable)**

If `packages/web/components/Nav.tsx` enumerates studio destinations, add `{ href: "/studio/batch", label: "Batch" }` in the same shape as the others (read the file first; match its active-path logic). If Nav does not list per-tool studio links, skip this step and note it in the report.

- [ ] **Step 3: Build to verify**

Run: `npm -w @event-editor/web run build && npm -w @event-editor/web run test`
Expected: build clean; full web suite still green.

- [ ] **Step 4: Commit**

```bash
git add packages/web/app/studio/batch/StudioBatchClient.tsx packages/web/components/Nav.tsx
git commit -m "feat(web): batch generate, results grid, download all"
```

---

## Task 14: Docs + env

**Files:**
- Create: `docs/setup/sheets.md`
- Modify: `.env.example`, `README.md`

- [ ] **Step 1: Write `docs/setup/sheets.md`**

Cover concretely:
1. Batch headshots read a master Google Sheet — the Google connection needs the `spreadsheets.readonly` scope; if you connected before 4c, `/settings` shows a re-auth prompt. Click re-auth and approve.
2. Sheet shape: first row is a header; include columns for name and title, and ideally a photo column (a Drive share link, a file id, or the photo's filename).
3. Photo matching: a photo column wins; otherwise the tool matches each person's name against the chosen Drive folder's filenames (case/extension/punctuation-insensitive). Ambiguous or unmatched rows are shown but not rendered until resolved.
4. Pick the renderer (Local frame or Canva template) and one style applied to the whole group; the Canva path needs the 4b setup (`docs/setup/canva.md`).
5. Generate, review the grid, retry any failed row, and use "Download all" for a zip.
6. `EE_BATCH_CONCURRENCY` (default 3) bounds how many renders launch at once; raise it if your Canva rate limits are generous.

No em dashes; sentence case headings.

- [ ] **Step 2: Add `EE_BATCH_CONCURRENCY` to `.env.example`**

Append (hyphen, not em dash):

```
# Batch headshots - how many renders to launch at once (default 3)
EE_BATCH_CONCURRENCY=3
```

- [ ] **Step 3: README pointer**

In the Headshot Studio section, add: "Batch from a sheet: see `docs/setup/sheets.md`."

- [ ] **Step 4: Commit**

```bash
git add docs/setup/sheets.md .env.example README.md
git commit -m "docs: sheet-driven batch setup guide + EE_BATCH_CONCURRENCY"
```

---

## Self-Review notes (author)

- **Spec coverage:** Sheets read + scope widening (T5/T6/T7), column detect (T1), photo matching (T2), batch_id guarded migration (T3), createBatchHeadshots (T4), batch runner + concurrency + matchSheetRows (T8), match/create routes (T9), poll + per-row retry (T10), zip (T11), UI setup+table (T12), UI generate+results+download (T13), docs + env (T14). Both-renderer support is in T4/T8/T9/T12/T13 (renderer + styleId threaded through). Deferred per spec: Drive write-back, batches table, resume-across-restart, ambiguous candidate-picking (T12 marks ambiguous rows non-selectable; a follow-up can add candidate selection).
- **Migration landmine:** T3 adds `batch_id` to BOTH the DDL CREATE block (fresh dbs, satisfies the drift test) and a guarded `ALTER` (pre-existing 4a/4b dbs), run after `migrateHeadshots` so a rebuilt legacy table also gets it. The dedicated `batch-migration.test.ts` exercises the ALTER path on a column-less table.
- **Type consistency:** `RowMatch`/`matchRow` (T2) feed `matchSheetRows` (T8) and the match route (T9); `createBatchHeadshots` signature (T4) matches the create route's call (T9); `batchId` column (T3) is read by the poll/zip routes (T10/T11) and written by the create helpers (T4).
- **Known soft spot to verify during implementation:** the import path placeholder in T9's match route (`@/lib/google/drive-helpers`) is called out inline — use the real `@/lib/google/oauth` (`authedDriveClient`) and `@/lib/google/drive` (`makeDriveClient`). And the zip route's stream-to-Response (T11) has a documented fallback if the direct cast fails the Next build.
