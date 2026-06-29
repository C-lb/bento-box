# Headshot Studio 4a (local renderer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `/studio` flow that turns a Drive photo into a branded headshot PNG, fully offline with a local sharp/SVG renderer (no Canva).

**Architecture:** `packages/core` holds node-free, dependency-injected logic (frame specs + the create/run pipeline, mirroring `transcription.ts`). `packages/web` holds the node glue (sharp compositing, DM Sans text-to-path, Drive full-res download, fs writes, Next routes, and the stepped UI). The render runs async and is polled, exactly like the audio transcriber.

**Tech Stack:** TypeScript, better-sqlite3 + Drizzle, sharp (already a dep), `text-to-svg` (new, for deterministic DM Sans glyph paths), googleapis, Next.js App Router.

## Global Constraints

- **Monorepo boundary:** `packages/core` must stay node-free and side-effect-free — pure logic with injected dependencies. All sharp/fs/google/font work lives in `packages/web/lib`.
- **Import extensions:** In `packages/core`, relative imports KEEP the `.js` extension (NodeNext build), e.g. `import { headshots } from "./schema/index.js"`. In `packages/web` lib/app code, relative VALUE imports must be **EXTENSIONLESS** (Turbopack won't map `.js`→`.ts` for resolved value imports), e.g. `import { renderHeadshot } from "./headshot-render"`. Cross-package imports use the package subpath (`@event-editor/core/headshot`).
- **Rebuild core dist after any core change:** web imports the compiled `dist/`, not `src/`. After editing core, run `npm -w @event-editor/core run build` before web build/serve, or the change is invisible (this exact mismatch bit us in the transcriber Task 8).
- **Re-migrate the dev DB after the schema change:** `npm -w @event-editor/core run migrate`.
- **anti-vibecode skill applies to all `/studio` UI:** one accent colour over neutral, no background spotlight gradients, no side accent stripes, soft diffuse shadows, sentence-case eyebrows, plain copy, **no em dashes**.
- **Output dir override:** the renderer writes PNGs under `process.env.EE_HEADSHOT_DIR ?? "data/headshots"` so tests can redirect to a tmp dir.
- **Keep both suites green:** `npm -w @event-editor/core test` (35 passing today) and `npm -w @event-editor/web test` (20 passing today). `npm run build` from repo root must stay clean.

---

### Task 1: Generalize the `headshots` schema + guarded migration

**Files:**
- Modify: `packages/core/src/schema/index.ts` (the `headshots` table, ~line 36)
- Modify: `packages/core/src/migrate.ts` (headshots DDL + new rebuild helper)
- Test: `packages/core/test/headshots-migration.test.ts` (create)
- Existing `packages/core/test/drift.test.ts` already asserts headshots DDL == Drizzle column names; it must stay green.

**Interfaces:**
- Produces: a `headshots` table (fresh + migrated) with columns: `id, source, source_photo_id, source_upload_path, source_drive_file_id, renderer, canva_template_id (NULLABLE), template_id, name_text, title_text, autofill_job_id, design_id, status, output_path, export_url, error_message, created_at, updated_at`. `runMigrations(db)` is idempotent and rebuilds a legacy headshots table in place.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/headshots-migration.test.ts
import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { openDb, runMigrations } from "../src/index.js";

function cols(db: ReturnType<typeof openDb>): Array<{ name: string; notnull: number }> {
  return db.all(sql.raw("PRAGMA table_info(headshots)")) as Array<{ name: string; notnull: number }>;
}

describe("headshots migration", () => {
  it("fresh db has the generalized columns and nullable canva_template_id", () => {
    const db = openDb(join(tmpdir(), `ee-hm-${Math.random().toString(36).slice(2)}.db`));
    runMigrations(db);
    const c = cols(db);
    const names = new Set(c.map((r) => r.name));
    for (const n of ["renderer", "template_id", "output_path", "source_drive_file_id"]) {
      expect(names.has(n)).toBe(true);
    }
    expect(c.find((r) => r.name === "canva_template_id")!.notnull).toBe(0);
  });

  it("rebuilds a legacy headshots table without dropping rows, idempotently", () => {
    const db = openDb(join(tmpdir(), `ee-hm-${Math.random().toString(36).slice(2)}.db`));
    // simulate the old (Canva-only) shape with a row in it
    db.run(sql.raw(`CREATE TABLE headshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      source_photo_id INTEGER,
      source_upload_path TEXT,
      canva_template_id TEXT NOT NULL,
      name_text TEXT, title_text TEXT,
      autofill_job_id TEXT, design_id TEXT,
      status TEXT NOT NULL DEFAULT 'autofilling',
      export_url TEXT, error_message TEXT,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0)`));
    db.run(sql.raw(`INSERT INTO headshots (source, canva_template_id, status) VALUES ('upload','T1','done')`));

    runMigrations(db);
    runMigrations(db); // second run must be a no-op, not a re-rebuild error

    const names = new Set(cols(db).map((r) => r.name));
    expect(names.has("renderer")).toBe(true);
    expect(names.has("output_path")).toBe(true);
    const rows = db.all(sql.raw("SELECT source, canva_template_id, renderer FROM headshots")) as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].source).toBe("upload");
    expect(rows[0].renderer).toBe("local"); // default backfilled on rebuild
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm -w @event-editor/core test -- headshots-migration`
Expected: FAIL — `renderer`/`output_path` columns missing on fresh db; legacy rebuild not implemented.

- [ ] **Step 3: Update the Drizzle schema**

In `packages/core/src/schema/index.ts`, replace the `headshots` table with:

```ts
export const headshots = sqliteTable("headshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(), // drive|upload|sorter
  sourcePhotoId: integer("source_photo_id").references(() => photos.id),
  sourceUploadPath: text("source_upload_path"),
  sourceDriveFileId: text("source_drive_file_id"),
  renderer: text("renderer").notNull().default("local"), // local|canva
  canvaTemplateId: text("canva_template_id"), // nullable now (canva path only)
  templateId: text("template_id"), // generic frame id, e.g. clean-band
  nameText: text("name_text"),
  titleText: text("title_text"),
  autofillJobId: text("autofill_job_id"),
  designId: text("design_id"),
  status: text("status").notNull().default("rendering"), // rendering|autofilling|exporting|done|error
  outputPath: text("output_path"),
  exportUrl: text("export_url"),
  errorMessage: text("error_message"),
  createdAt: integer("created_at").notNull().default(0),
  updatedAt: integer("updated_at").notNull().default(0),
});
```

- [ ] **Step 4: Update the migration DDL + add the rebuild helper**

In `packages/core/src/migrate.ts`, replace the `headshots` entry in `DDL` with the target shape (so fresh DBs are correct):

```ts
  `CREATE TABLE IF NOT EXISTS headshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    source_photo_id INTEGER REFERENCES photos(id),
    source_upload_path TEXT,
    source_drive_file_id TEXT,
    renderer TEXT NOT NULL DEFAULT 'local',
    canva_template_id TEXT,
    template_id TEXT,
    name_text TEXT,
    title_text TEXT,
    autofill_job_id TEXT,
    design_id TEXT,
    status TEXT NOT NULL DEFAULT 'rendering',
    output_path TEXT,
    export_url TEXT,
    error_message TEXT,
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  )`,
```

Then add a rebuild helper and call it from `runMigrations`, AFTER the DDL loop:

```ts
// Legacy DBs created before 4a have a Canva-only headshots table (NOT NULL
// canva_template_id, missing renderer/template_id/output_path). CREATE TABLE
// IF NOT EXISTS skips them, so rebuild in place. Detection: the `renderer`
// column is absent. The copy is explicit (overlapping legacy columns only) so
// no rows are lost; second run finds `renderer` present and no-ops.
function migrateHeadshots(db: BetterSQLite3Database<any>): void {
  const info = db.all(sql.raw("PRAGMA table_info(headshots)")) as Array<{ name: string }>;
  const names = new Set(info.map((r) => r.name));
  if (names.size === 0) return; // table didn't exist; DDL already made the new shape
  if (names.has("renderer")) return; // already migrated

  db.run(sql.raw("ALTER TABLE headshots RENAME TO headshots_legacy"));
  db.run(sql.raw(`CREATE TABLE headshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    source_photo_id INTEGER REFERENCES photos(id),
    source_upload_path TEXT,
    source_drive_file_id TEXT,
    renderer TEXT NOT NULL DEFAULT 'local',
    canva_template_id TEXT,
    template_id TEXT,
    name_text TEXT,
    title_text TEXT,
    autofill_job_id TEXT,
    design_id TEXT,
    status TEXT NOT NULL DEFAULT 'rendering',
    output_path TEXT,
    export_url TEXT,
    error_message TEXT,
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  )`));
  db.run(sql.raw(`INSERT INTO headshots
    (id, source, source_photo_id, source_upload_path, canva_template_id,
     name_text, title_text, autofill_job_id, design_id, status, export_url,
     error_message, created_at, updated_at)
    SELECT id, source, source_photo_id, source_upload_path, canva_template_id,
     name_text, title_text, autofill_job_id, design_id, status, export_url,
     error_message, created_at, updated_at
    FROM headshots_legacy`));
  db.run(sql.raw("DROP TABLE headshots_legacy"));
}

export function runMigrations(db: BetterSQLite3Database<any>): void {
  for (const stmt of DDL) {
    db.run(sql.raw(stmt));
  }
  migrateHeadshots(db);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm -w @event-editor/core test`
Expected: PASS — new migration test green, `drift.test.ts` headshots case green (DDL names now match the Drizzle schema), all 37+ tests pass.

- [ ] **Step 6: Rebuild core dist + commit**

```bash
npm -w @event-editor/core run build
git add packages/core/src/schema/index.ts packages/core/src/migrate.ts packages/core/test/headshots-migration.test.ts packages/core/dist
git commit -m "feat(core): generalize headshots schema for local+canva renderers with guarded migration"
```

---

### Task 2: Frame specs (`core/frames.ts`)

**Files:**
- Create: `packages/core/src/frames.ts`
- Modify: `packages/core/src/index.ts` (add `export * from "./frames.js"`)
- Modify: `packages/core/package.json` (add `"./frames": "./dist/frames.js"` to `exports`)
- Test: `packages/core/test/frames.test.ts` (create)

**Interfaces:**
- Produces:
  - `type CropShape = "rect" | "circle"`
  - `interface TextLine { x: number; y: number; size: number; color: string; anchor: "left" | "center" }`
  - `interface FrameSpec { id: string; label: string; canvas: number; bg: string; photo: { x: number; y: number; w: number; h: number; shape: CropShape }; band?: { x: number; y: number; w: number; h: number; fill: string }; plate?: { x: number; y: number; w: number; h: number; rx: number; fill: string }; accent?: { x: number; y: number; w: number; h: number; fill: string }; name: TextLine; title: TextLine }`
  - `const FRAMES: Record<string, FrameSpec>`
  - `function getFrame(id: string): FrameSpec | undefined`
  - `const FRAME_LIST: FrameSpec[]`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/frames.test.ts
import { describe, it, expect } from "vitest";
import { FRAMES, FRAME_LIST, getFrame } from "../src/frames.js";

describe("frames", () => {
  it("exposes exactly the three 4a frames", () => {
    expect(FRAME_LIST.map((f) => f.id).sort()).toEqual(["circle", "clean-band", "minimal-corner"]);
  });
  it("every frame is a 1080 square with a photo region inside the canvas", () => {
    for (const f of FRAME_LIST) {
      expect(f.canvas).toBe(1080);
      expect(f.photo.x + f.photo.w).toBeLessThanOrEqual(1080);
      expect(f.photo.y + f.photo.h).toBeLessThanOrEqual(1080);
    }
  });
  it("the circle frame uses a circular crop", () => {
    expect(getFrame("circle")!.photo.shape).toBe("circle");
  });
  it("returns undefined for unknown ids", () => {
    expect(getFrame("nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm -w @event-editor/core test -- frames`
Expected: FAIL — cannot find module `../src/frames.js`.

- [ ] **Step 3: Implement `frames.ts`**

```ts
// packages/core/src/frames.ts
export type CropShape = "rect" | "circle";

export interface TextLine {
  x: number;
  y: number; // top of the text box
  size: number;
  color: string;
  anchor: "left" | "center";
}

export interface FrameSpec {
  id: string;
  label: string;
  canvas: number;
  bg: string;
  photo: { x: number; y: number; w: number; h: number; shape: CropShape };
  band?: { x: number; y: number; w: number; h: number; fill: string };
  plate?: { x: number; y: number; w: number; h: number; rx: number; fill: string };
  accent?: { x: number; y: number; w: number; h: number; fill: string };
  name: TextLine;
  title: TextLine;
}

const ACCENT = "#2563eb";

export const FRAMES: Record<string, FrameSpec> = {
  "clean-band": {
    id: "clean-band",
    label: "Clean band",
    canvas: 1080,
    bg: "#ffffff",
    photo: { x: 0, y: 0, w: 1080, h: 1080, shape: "rect" },
    band: { x: 0, y: 842, w: 1080, h: 238, fill: "#1c1c1e" },
    accent: { x: 0, y: 839, w: 1080, h: 3, fill: ACCENT },
    name: { x: 64, y: 902, size: 52, color: "#ffffff", anchor: "left" },
    title: { x: 64, y: 974, size: 30, color: "#a1a1aa", anchor: "left" },
  },
  circle: {
    id: "circle",
    label: "Circle",
    canvas: 1080,
    bg: "#f5f5f4",
    photo: { x: 230, y: 120, w: 620, h: 620, shape: "circle" },
    accent: { x: 490, y: 800, w: 100, h: 3, fill: ACCENT },
    name: { x: 540, y: 832, size: 52, color: "#18181b", anchor: "center" },
    title: { x: 540, y: 904, size: 30, color: "#71717a", anchor: "center" },
  },
  "minimal-corner": {
    id: "minimal-corner",
    label: "Minimal corner",
    canvas: 1080,
    bg: "#ffffff",
    photo: { x: 0, y: 0, w: 1080, h: 1080, shape: "rect" },
    plate: { x: 48, y: 880, w: 560, h: 152, rx: 20, fill: "#fffffff2" },
    name: { x: 84, y: 912, size: 46, color: ACCENT, anchor: "left" },
    title: { x: 84, y: 976, size: 28, color: "#52525b", anchor: "left" },
  },
};

export function getFrame(id: string): FrameSpec | undefined {
  return FRAMES[id];
}

export const FRAME_LIST: FrameSpec[] = Object.values(FRAMES);
```

Then add `export * from "./frames.js";` to `packages/core/src/index.ts`, and `"./frames": "./dist/frames.js"` to the `exports` map in `packages/core/package.json`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm -w @event-editor/core test -- frames`
Expected: PASS.

- [ ] **Step 5: Rebuild dist + commit**

```bash
npm -w @event-editor/core run build
git add packages/core/src/frames.ts packages/core/src/index.ts packages/core/package.json packages/core/test/frames.test.ts packages/core/dist
git commit -m "feat(core): add local headshot frame specs (clean-band, circle, minimal-corner)"
```

---

### Task 3: Headshot pipeline (`core/headshot.ts`)

**Files:**
- Create: `packages/core/src/headshot.ts`
- Modify: `packages/core/src/index.ts` (add `export * from "./headshot.js"`)
- Modify: `packages/core/package.json` (add `"./headshot": "./dist/headshot.js"`)
- Test: `packages/core/test/headshot.test.ts` (create)

**Interfaces:**
- Consumes: `getFrame` and `FrameSpec` from `./frames.js`; `headshots` from `./schema/index.js`.
- Produces:
  - `interface HeadshotRenderDeps { loadPhoto(driveFileId: string): Promise<Buffer>; render(photo: Buffer, frame: FrameSpec, nameText: string, titleText: string): Promise<Buffer>; save(id: number, png: Buffer): Promise<string> }`
  - `interface CreateHeadshotArgs { driveFileId: string; frameId: string; nameText: string; titleText: string }`
  - `function createHeadshot(db, args): number` — inserts a row (`renderer:"local"`, `status:"rendering"`, `templateId:frameId`, `sourceDriveFileId:driveFileId`, `source:"drive"`) and returns its id.
  - `function runHeadshotRender(db, id, deps): Promise<void>` — loads photo, renders, saves, sets `status:"done"` + `outputPath`; any throw sets `status:"error"` + `errorMessage`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/headshot.test.ts
import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openDb, runMigrations, headshots } from "../src/index.js";
import { createHeadshot, runHeadshotRender } from "../src/headshot.js";

function freshDb() {
  const db = openDb(join(tmpdir(), `ee-hs-${Math.random().toString(36).slice(2)}.db`));
  runMigrations(db);
  return db;
}
const row = (db: any, id: number) =>
  db.select().from(headshots).where(eq(headshots.id, id)).all()[0];

describe("headshot pipeline", () => {
  it("createHeadshot inserts a local row in rendering status", () => {
    const db = freshDb();
    const id = createHeadshot(db, { driveFileId: "f1", frameId: "circle", nameText: "Jane", titleText: "Lead" });
    const r = row(db, id);
    expect(r.renderer).toBe("local");
    expect(r.status).toBe("rendering");
    expect(r.templateId).toBe("circle");
    expect(r.sourceDriveFileId).toBe("f1");
  });

  it("runHeadshotRender drives the row to done with an output path", async () => {
    const db = freshDb();
    const id = createHeadshot(db, { driveFileId: "f1", frameId: "circle", nameText: "Jane", titleText: "Lead" });
    const calls: string[] = [];
    await runHeadshotRender(db, id, {
      loadPhoto: async (fid) => { calls.push(`load:${fid}`); return Buffer.from("photo"); },
      render: async (_p, frame) => { calls.push(`render:${frame.id}`); return Buffer.from("png"); },
      save: async (hid, png) => { calls.push(`save:${hid}:${png.length}`); return `data/headshots/${hid}.png`; },
    });
    const r = row(db, id);
    expect(r.status).toBe("done");
    expect(r.outputPath).toBe(`data/headshots/${id}.png`);
    expect(calls).toEqual(["load:f1", "render:circle", `save:${id}:3`]);
  });

  it("marks the row errored when a dependency throws", async () => {
    const db = freshDb();
    const id = createHeadshot(db, { driveFileId: "f1", frameId: "circle", nameText: "Jane", titleText: "Lead" });
    await runHeadshotRender(db, id, {
      loadPhoto: async () => { throw new Error("drive boom"); },
      render: async () => Buffer.from("png"),
      save: async () => "x",
    });
    const r = row(db, id);
    expect(r.status).toBe("error");
    expect(r.errorMessage).toContain("drive boom");
  });

  it("errors on an unknown frame id", async () => {
    const db = freshDb();
    const id = createHeadshot(db, { driveFileId: "f1", frameId: "ghost", nameText: "", titleText: "" });
    await runHeadshotRender(db, id, {
      loadPhoto: async () => Buffer.from("p"),
      render: async () => Buffer.from("png"),
      save: async () => "x",
    });
    expect(row(db, id).status).toBe("error");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm -w @event-editor/core test -- headshot`
Expected: FAIL — cannot find module `../src/headshot.js`.

- [ ] **Step 3: Implement `headshot.ts`**

```ts
// packages/core/src/headshot.ts
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { headshots } from "./schema/index.js";
import { getFrame, type FrameSpec } from "./frames.js";

export interface HeadshotRenderDeps {
  loadPhoto(driveFileId: string): Promise<Buffer>;
  render(photo: Buffer, frame: FrameSpec, nameText: string, titleText: string): Promise<Buffer>;
  save(id: number, png: Buffer): Promise<string>;
}

export interface CreateHeadshotArgs {
  driveFileId: string;
  frameId: string;
  nameText: string;
  titleText: string;
}

function touch(db: BetterSQLite3Database<any>, id: number, set: Record<string, unknown>) {
  db.update(headshots).set({ ...set, updatedAt: Date.now() }).where(eq(headshots.id, id)).run();
}

export function createHeadshot(db: BetterSQLite3Database<any>, args: CreateHeadshotArgs): number {
  const now = Date.now();
  const res = db
    .insert(headshots)
    .values({
      source: "drive",
      sourceDriveFileId: args.driveFileId,
      renderer: "local",
      canvaTemplateId: null,
      templateId: args.frameId,
      nameText: args.nameText,
      titleText: args.titleText,
      status: "rendering",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return Number(res.lastInsertRowid);
}

export async function runHeadshotRender(
  db: BetterSQLite3Database<any>,
  id: number,
  deps: HeadshotRenderDeps,
): Promise<void> {
  try {
    const row = db.select().from(headshots).where(eq(headshots.id, id)).all()[0];
    if (!row) throw new Error(`headshot ${id} not found`);
    const frame = getFrame(row.templateId ?? "");
    if (!frame) throw new Error(`unknown frame: ${row.templateId}`);

    const photo = await deps.loadPhoto(row.sourceDriveFileId!);
    const png = await deps.render(photo, frame, row.nameText ?? "", row.titleText ?? "");
    const path = await deps.save(id, png);
    touch(db, id, { outputPath: path, status: "done" });
  } catch (err) {
    touch(db, id, { status: "error", errorMessage: err instanceof Error ? err.message : String(err) });
  }
}
```

Add `export * from "./headshot.js";` to `index.ts` and `"./headshot": "./dist/headshot.js"` to `package.json` exports.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm -w @event-editor/core test`
Expected: PASS — all core tests green.

- [ ] **Step 5: Rebuild dist + commit**

```bash
npm -w @event-editor/core run build
git add packages/core/src/headshot.ts packages/core/src/index.ts packages/core/package.json packages/core/test/headshot.test.ts packages/core/dist
git commit -m "feat(core): add headshot create + run-render pipeline (DI'd)"
```

---

### Task 4: DM Sans glyph paths (`web/lib/text-render.ts`)

**Files:**
- Add asset: `packages/web/assets/fonts/DMSans-Medium.ttf` (download from Google Fonts — DM Sans, Medium 500 weight)
- Create: `packages/web/lib/text-render.ts`
- Modify: `packages/web/vendor.d.ts` (add a `text-to-svg` module declaration)
- Modify: `packages/web/package.json` (add `text-to-svg` dependency)
- Test: `packages/web/test/text-render.test.ts` (create)

**Interfaces:**
- Produces: `function glyphPath(text: string, opts: { x: number; y: number; fontSize: number; anchor: "left" | "center"; color: string }): string` — returns an SVG `<path .../>` string (empty string for empty text) rendering `text` in DM Sans as vector paths.

- [ ] **Step 1: Install the dep + add the font + type stub**

```bash
npm -w @event-editor/web install text-to-svg@3.1.5
# place DMSans-Medium.ttf into packages/web/assets/fonts/ (Google Fonts -> DM Sans -> Medium)
```

Add to `packages/web/vendor.d.ts`:

```ts
declare module "text-to-svg" {
  interface GetPathOptions {
    x?: number;
    y?: number;
    fontSize?: number;
    anchor?: string;
    attributes?: Record<string, string>;
  }
  export default class TextToSVG {
    static loadSync(file?: string): TextToSVG;
    getPath(text: string, options?: GetPathOptions): string;
  }
}
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/web/test/text-render.test.ts
import { describe, it, expect } from "vitest";
import { glyphPath } from "../lib/text-render";

describe("glyphPath", () => {
  it("returns an svg path with the requested fill", () => {
    const out = glyphPath("Jane Okafor", { x: 64, y: 100, fontSize: 52, anchor: "left", color: "#ffffff" });
    expect(out).toContain("<path");
    expect(out).toContain('fill="#ffffff"');
    expect(out).toMatch(/d="M/); // real glyph path data
  });
  it("returns empty string for empty text", () => {
    expect(glyphPath("", { x: 0, y: 0, fontSize: 30, anchor: "center", color: "#000" })).toBe("");
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm -w @event-editor/web test -- text-render`
Expected: FAIL — cannot find module `../lib/text-render`.

- [ ] **Step 4: Implement `text-render.ts`**

```ts
// packages/web/lib/text-render.ts
import { resolve } from "node:path";
import TextToSVG from "text-to-svg";

// cwd is packages/web at runtime (Next) and under vitest. Load once.
const tts = TextToSVG.loadSync(resolve(process.cwd(), "assets/fonts/DMSans-Medium.ttf"));

export function glyphPath(
  text: string,
  opts: { x: number; y: number; fontSize: number; anchor: "left" | "center"; color: string },
): string {
  if (!text) return "";
  return tts.getPath(text, {
    x: opts.x,
    y: opts.y,
    fontSize: opts.fontSize,
    anchor: opts.anchor === "center" ? "center top" : "left top",
    attributes: { fill: opts.color },
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm -w @event-editor/web test -- text-render`
Expected: PASS. (If `text-to-svg` fails to bundle under Turbopack later, add `"text-to-svg"` to `serverExternalPackages` in `next.config.ts` — same list sharp is in.)

- [ ] **Step 6: Commit**

```bash
git add packages/web/assets/fonts/DMSans-Medium.ttf packages/web/lib/text-render.ts packages/web/vendor.d.ts packages/web/package.json packages/web/package-lock.json
git commit -m "feat(web): DM Sans glyph-path text rendering for headshots"
```

---

### Task 5: Sharp renderer (`web/lib/headshot-render.ts`)

**Files:**
- Create: `packages/web/lib/headshot-render.ts`
- Test: `packages/web/test/headshot-render.test.ts` (create)

**Interfaces:**
- Consumes: `FrameSpec` from `@event-editor/core/frames`; `glyphPath` from `./text-render`.
- Produces: `function renderHeadshot(photo: Buffer, frame: FrameSpec, nameText: string, titleText: string): Promise<Buffer>` — returns a `canvas × canvas` PNG.

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/test/headshot-render.test.ts
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { getFrame } from "@event-editor/core/frames";
import { renderHeadshot } from "../lib/headshot-render";

async function redSquare(size = 400): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 3, background: "#cc0000" } }).png().toBuffer();
}

describe("renderHeadshot", () => {
  for (const id of ["clean-band", "circle", "minimal-corner"]) {
    it(`renders the ${id} frame to a 1080 square png`, async () => {
      const out = await renderHeadshot(await redSquare(), getFrame(id)!, "Jane Okafor", "Head of Partnerships");
      const meta = await sharp(out).metadata();
      expect(meta.format).toBe("png");
      expect(meta.width).toBe(1080);
      expect(meta.height).toBe(1080);
    });
  }

  it("actually draws the name text (band area is not blank where a glyph sits)", async () => {
    const out = await renderHeadshot(await redSquare(), getFrame("clean-band")!, "Jane Okafor", "Head");
    // sample the band region (charcoal bg, white glyphs). Average it; pure
    // charcoal would be ~ (28,28,30). White glyph pixels lift the mean.
    const { data, info } = await sharp(out)
      .extract({ left: 64, top: 880, width: 420, height: 70 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    let sum = 0;
    for (let i = 0; i < data.length; i += info.channels) sum += data[i]; // red channel
    const mean = sum / (data.length / info.channels);
    expect(mean).toBeGreaterThan(40); // > flat charcoal => glyphs rendered
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm -w @event-editor/web test -- headshot-render`
Expected: FAIL — cannot find module `../lib/headshot-render`.

- [ ] **Step 3: Implement `headshot-render.ts`**

```ts
// packages/web/lib/headshot-render.ts
import sharp from "sharp";
import type { FrameSpec, TextLine } from "@event-editor/core/frames";
import { glyphPath } from "./text-render";

function textSvg(line: TextLine, text: string): string {
  // text-to-svg anchors at the box top; nudge baseline to roughly center the cap height.
  return glyphPath(text, {
    x: line.x,
    y: line.y,
    fontSize: line.size,
    anchor: line.anchor,
    color: line.color,
  });
}

function buildOverlaySvg(frame: FrameSpec, nameText: string, titleText: string): string {
  const C = frame.canvas;
  const parts: string[] = [];
  if (frame.plate) {
    const p = frame.plate;
    parts.push(
      `<filter id="plateShadow" x="-20%" y="-20%" width="140%" height="140%">` +
        `<feDropShadow dx="0" dy="6" stdDeviation="12" flood-color="#000000" flood-opacity="0.18"/></filter>`,
    );
    parts.push(
      `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="${p.rx}" fill="${p.fill}" filter="url(#plateShadow)"/>`,
    );
  }
  if (frame.band) {
    const b = frame.band;
    parts.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${b.fill}"/>`);
  }
  if (frame.accent) {
    const a = frame.accent;
    parts.push(`<rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" fill="${a.fill}"/>`);
  }
  parts.push(textSvg(frame.name, nameText));
  parts.push(textSvg(frame.title, titleText));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${C}" height="${C}"><defs></defs>${parts.join("")}</svg>`;
}

export async function renderHeadshot(
  photo: Buffer,
  frame: FrameSpec,
  nameText: string,
  titleText: string,
): Promise<Buffer> {
  const C = frame.canvas;
  const layers: sharp.OverlayOptions[] = [];

  let photoLayer = sharp(photo).resize(frame.photo.w, frame.photo.h, { fit: "cover", position: "centre" });
  if (frame.photo.shape === "circle") {
    const r = Math.min(frame.photo.w, frame.photo.h) / 2;
    const mask = Buffer.from(
      `<svg width="${frame.photo.w}" height="${frame.photo.h}">` +
        `<circle cx="${frame.photo.w / 2}" cy="${frame.photo.h / 2}" r="${r}" fill="#fff"/></svg>`,
    );
    photoLayer = photoLayer.composite([{ input: mask, blend: "dest-in" }]);
  }
  const photoBuf = await photoLayer.png().toBuffer();
  layers.push({ input: photoBuf, left: frame.photo.x, top: frame.photo.y });
  layers.push({ input: Buffer.from(buildOverlaySvg(frame, nameText, titleText)), left: 0, top: 0 });

  return sharp({ create: { width: C, height: C, channels: 4, background: frame.bg } })
    .composite(layers)
    .png()
    .toBuffer();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm -w @event-editor/web test -- headshot-render`
Expected: PASS — three frames render at 1080², name text raises the band mean above flat charcoal.

> If the name-text assertion fails (band stays flat charcoal), the bundled DM Sans glyph paths are empty — confirm `DMSans-Medium.ttf` is a valid TTF at `assets/fonts/`. The `text-to-svg` path approach needs no system font; a blank result means the font file is missing or corrupt, not a renderer bug.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/headshot-render.ts packages/web/test/headshot-render.test.ts
git commit -m "feat(web): sharp headshot compositor (cover-crop, circle mask, band/plate, text)"
```

---

### Task 6: Drive full-res download + thumbnail-by-id (`web/lib/google/drive.ts`)

**Files:**
- Modify: `packages/web/lib/google/drive.ts` (add two methods to `DriveClient` + impl)
- Test: `packages/web/test/drive.test.ts` (add cases)

**Interfaces:**
- Produces, added to `interface DriveClient`:
  - `downloadFile(fileId: string): Promise<Buffer>` — full-res original bytes via `files.get({ fileId, alt: "media" })`.
  - `thumbnailFor(fileId: string): Promise<Buffer | null>` — fetches `thumbnailLink` metadata then downloads it; `null` if no thumbnail.

- [ ] **Step 1: Write the failing test**

```ts
// add to packages/web/test/drive.test.ts
import { describe, it, expect } from "vitest";
import { makeDriveClient } from "../lib/google/drive";

describe("downloadFile", () => {
  it("returns the raw bytes from files.get alt=media", async () => {
    const fake = {
      files: {
        get: async (params: any) => {
          expect(params.fileId).toBe("F1");
          expect(params.alt).toBe("media");
          return { data: new TextEncoder().encode("RAWBYTES").buffer };
        },
      },
      context: { _options: { auth: {} } },
    };
    const buf = await makeDriveClient(fake as any).downloadFile("F1");
    expect(buf.toString()).toBe("RAWBYTES");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm -w @event-editor/web test -- drive`
Expected: FAIL — `downloadFile` is not a function.

- [ ] **Step 3: Implement the methods**

In `packages/web/lib/google/drive.ts`, add to the `DriveClient` interface:

```ts
  downloadFile(fileId: string): Promise<Buffer>;
  thumbnailFor(fileId: string): Promise<Buffer | null>;
```

And add to the object returned by `makeDriveClient` (after `downloadThumbnail`):

```ts
    async downloadFile(fileId: string) {
      const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
      return Buffer.from(res.data as ArrayBuffer);
    },
    async thumbnailFor(fileId: string) {
      const meta = await drive.files.get({ fileId, fields: "thumbnailLink" });
      const link = meta.data.thumbnailLink;
      if (!link) return null;
      try {
        const res = await (drive.context._options.auth as any).request({
          url: link,
          responseType: "arraybuffer",
        });
        return Buffer.from(res.data as ArrayBuffer);
      } catch {
        return null;
      }
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm -w @event-editor/web test -- drive`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/google/drive.ts packages/web/test/drive.test.ts
git commit -m "feat(web): drive downloadFile (full-res) + thumbnailFor (by id)"
```

---

### Task 7: Studio glue (`web/lib/studio.ts`)

**Files:**
- Create: `packages/web/lib/studio.ts`
- Test: `packages/web/test/studio.test.ts` (create)

**Interfaces:**
- Consumes: `runHeadshotRender` from `@event-editor/core/headshot`; `renderHeadshot` from `./headshot-render`; `DriveClient` from `./google/drive`.
- Produces:
  - `const HEADSHOT_DIR: string` (`process.env.EE_HEADSHOT_DIR ?? "data/headshots"`)
  - `function startHeadshot(db, drive: DriveClient, id: number): void` — fire-and-forget; wires Drive download + sharp render + fs save into `runHeadshotRender`.

- [ ] **Step 1: Write the failing test (integration: real render, fake drive, tmp output dir)**

```ts
// packages/web/test/studio.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, existsSync } from "node:fs";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { openDb, runMigrations, headshots } from "@event-editor/core";
import { createHeadshot } from "@event-editor/core/headshot";

const OUT = mkdtempSync(join(tmpdir(), "ee-hsout-"));
process.env.EE_HEADSHOT_DIR = OUT;

function freshDb() {
  const db = openDb(join(tmpdir(), `ee-st-${Math.random().toString(36).slice(2)}.db`));
  runMigrations(db);
  return db;
}

describe("startHeadshot", () => {
  it("renders a real png to disk and marks the row done", async () => {
    const { startHeadshot } = await import("../lib/studio"); // import after env set
    const db = freshDb();
    const id = createHeadshot(db, { driveFileId: "F1", frameId: "circle", nameText: "Jane", titleText: "Lead" });
    const fakeDrive = {
      async downloadFile() {
        return sharp({ create: { width: 300, height: 300, channels: 3, background: "#3366cc" } }).png().toBuffer();
      },
    };
    startHeadshot(db, fakeDrive as any, id);

    // poll the row (async pipeline)
    for (let i = 0; i < 50; i++) {
      const r = db.select().from(headshots).where(eq(headshots.id, id)).all()[0];
      if (r.status === "done" || r.status === "error") break;
      await new Promise((res) => setTimeout(res, 40));
    }
    const r = db.select().from(headshots).where(eq(headshots.id, id)).all()[0];
    expect(r.status).toBe("done");
    expect(r.outputPath).toBe(`${OUT}/${id}.png`);
    expect(existsSync(r.outputPath!)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm -w @event-editor/web test -- studio`
Expected: FAIL — cannot find module `../lib/studio`.

- [ ] **Step 3: Implement `studio.ts`**

```ts
// packages/web/lib/studio.ts
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { runHeadshotRender } from "@event-editor/core/headshot";
import type { openDb } from "@event-editor/core/db";
import type { DriveClient } from "./google/drive";
import { renderHeadshot } from "./headshot-render";

type Db = ReturnType<typeof openDb>;

export const HEADSHOT_DIR = process.env.EE_HEADSHOT_DIR ?? "data/headshots";

export function startHeadshot(db: Db, drive: DriveClient, id: number): void {
  void runHeadshotRender(db, id, {
    loadPhoto: (fileId) => drive.downloadFile(fileId),
    render: (photo, frame, name, title) => renderHeadshot(photo, frame, name, title),
    save: async (hid, png) => {
      await mkdir(resolve(HEADSHOT_DIR), { recursive: true });
      const rel = `${HEADSHOT_DIR}/${hid}.png`;
      await writeFile(resolve(rel), png);
      return rel;
    },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm -w @event-editor/web test -- studio`
Expected: PASS — a real PNG lands in the tmp dir, row is `done`.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/studio.ts packages/web/test/studio.test.ts
git commit -m "feat(web): startHeadshot glue (drive -> render -> disk)"
```

---

### Task 8: Output API — create/status/image routes

**Files:**
- Create: `packages/web/app/api/studio/headshots/route.ts` (POST create, GET list)
- Create: `packages/web/app/api/studio/headshots/[id]/route.ts` (GET status)
- Create: `packages/web/app/api/studio/image/[id]/route.ts` (GET PNG, path-contained)
- Test: `packages/web/test/studio-image-route.test.ts` (create — pure containment logic)

**Interfaces:**
- Consumes: `createHeadshot`/`getFrame` from core; `startHeadshot`/`HEADSHOT_DIR` from `@/lib/studio`; `authedDriveClient`, `makeDriveClient`, `getDb`.
- Produces: `POST /api/studio/headshots` → `{ id }`; `GET /api/studio/headshots` → `{ headshots: Dto[] }`; `GET /api/studio/headshots/[id]` → `{ headshot: Dto }`; `GET /api/studio/image/[id]` → `image/png` bytes. `Dto = { id, status, templateId, nameText, titleText, errorMessage, imageUrl }`.

- [ ] **Step 1: Write the failing test (image-route path containment)**

```ts
// packages/web/test/studio-image-route.test.ts
import { describe, it, expect } from "vitest";
import { isContained } from "../app/api/studio/image/[id]/contain";

describe("headshot image path containment", () => {
  it("accepts paths inside the headshot dir", () => {
    expect(isContained("/data/headshots", "/data/headshots/12.png")).toBe(true);
  });
  it("rejects traversal outside the headshot dir", () => {
    expect(isContained("/data/headshots", "/data/headshots/../../etc/passwd")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm -w @event-editor/web test -- studio-image-route`
Expected: FAIL — cannot find module `contain`.

- [ ] **Step 3: Implement the containment helper + the three routes**

`packages/web/app/api/studio/image/[id]/contain.ts`:

```ts
import { resolve } from "node:path";

export function isContained(baseDir: string, candidate: string): boolean {
  const base = resolve(baseDir);
  const target = resolve(candidate);
  return target === base || target.startsWith(base + "/");
}
```

`packages/web/app/api/studio/image/[id]/route.ts`:

```ts
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { headshots } from "@event-editor/core/schema";
import { getDb } from "@/lib/db";
import { HEADSHOT_DIR } from "@/lib/studio";
import { isContained } from "./contain";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = getDb().select().from(headshots).where(eq(headshots.id, Number(id))).all()[0];
  if (!row?.outputPath || !isContained(HEADSHOT_DIR, row.outputPath)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  try {
    const bytes = await readFile(resolve(row.outputPath));
    return new NextResponse(new Uint8Array(bytes), {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
```

`packages/web/app/api/studio/headshots/route.ts`:

```ts
import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { createHeadshot } from "@event-editor/core/headshot";
import { getFrame } from "@event-editor/core/frames";
import { headshots } from "@event-editor/core/schema";
import { getDb } from "@/lib/db";
import { startHeadshot } from "@/lib/studio";
import { authedDriveClient } from "@/lib/google/oauth";
import { makeDriveClient } from "@/lib/google/drive";

export const runtime = "nodejs";

function toDto(r: any) {
  return {
    id: r.id,
    status: r.status,
    templateId: r.templateId,
    nameText: r.nameText,
    titleText: r.titleText,
    errorMessage: r.errorMessage,
    imageUrl: r.status === "done" ? `/api/studio/image/${r.id}` : null,
  };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const driveFileId = body?.driveFileId;
  const frameId = body?.frameId;
  if (!driveFileId || !frameId) {
    return NextResponse.json({ error: "driveFileId and frameId required" }, { status: 400 });
  }
  if (!getFrame(frameId)) return NextResponse.json({ error: "unknown frame" }, { status: 400 });

  const db = getDb();
  const drive = await authedDriveClient(db);
  if (!drive) return NextResponse.json({ error: "not_connected" }, { status: 401 });

  const id = createHeadshot(db, {
    driveFileId,
    frameId,
    nameText: body?.nameText ?? "",
    titleText: body?.titleText ?? "",
  });
  startHeadshot(db, makeDriveClient(drive), id);
  return NextResponse.json({ id });
}

export async function GET() {
  const rows = getDb().select().from(headshots).orderBy(desc(headshots.id)).limit(24).all();
  return NextResponse.json({ headshots: rows.map(toDto) });
}
```

`packages/web/app/api/studio/headshots/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { headshots } from "@event-editor/core/schema";
import { getDb } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = getDb().select().from(headshots).where(eq(headshots.id, Number(id))).all()[0];
  if (!r) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({
    headshot: {
      id: r.id,
      status: r.status,
      templateId: r.templateId,
      nameText: r.nameText,
      titleText: r.titleText,
      errorMessage: r.errorMessage,
      imageUrl: r.status === "done" ? `/api/studio/image/${r.id}` : null,
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm -w @event-editor/web test -- studio-image-route`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/app/api/studio packages/web/test/studio-image-route.test.ts
git commit -m "feat(web): studio output API (create/status/list + path-contained image serve)"
```

---

### Task 9: Picker API — folder images + drive thumbnails

**Files:**
- Create: `packages/web/app/api/studio/images/route.ts` (GET `?folderId=`)
- Create: `packages/web/app/api/studio/drive-thumb/[fileId]/route.ts` (GET, streams jpeg)

**Interfaces:**
- Consumes: `authedDriveClient`, `makeDriveClient`, `getDb`.
- Produces: `GET /api/studio/images?folderId=X` → `{ images: { id, name }[] }`; `GET /api/studio/drive-thumb/[fileId]` → `image/jpeg` bytes (404 if no thumbnail). (Reuses the existing `GET /api/drive/folders` for the folder list.)

- [ ] **Step 1: Implement the images route**

`packages/web/app/api/studio/images/route.ts`:

```ts
import { NextResponse } from "next/server";
import { authedDriveClient } from "@/lib/google/oauth";
import { makeDriveClient } from "@/lib/google/drive";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const folderId = new URL(request.url).searchParams.get("folderId");
  if (!folderId) return NextResponse.json({ error: "folderId required" }, { status: 400 });
  const drive = await authedDriveClient(getDb());
  if (!drive) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  const images = await makeDriveClient(drive).listImages(folderId);
  return NextResponse.json({ images: images.map((i) => ({ id: i.id, name: i.name })) });
}
```

- [ ] **Step 2: Implement the drive-thumb route**

`packages/web/app/api/studio/drive-thumb/[fileId]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { authedDriveClient } from "@/lib/google/oauth";
import { makeDriveClient } from "@/lib/google/drive";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const drive = await authedDriveClient(getDb());
  if (!drive) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  const bytes = await makeDriveClient(drive).thumbnailFor(fileId);
  if (!bytes) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" },
  });
}
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm -w @event-editor/web run build`
Expected: build succeeds; the four `/api/studio/*` route groups appear in the route manifest.

- [ ] **Step 4: Commit**

```bash
git add packages/web/app/api/studio/images packages/web/app/api/studio/drive-thumb
git commit -m "feat(web): studio picker API (folder images + drive thumbnails)"
```

---

### Task 10: `/studio` UI + activate the landing link

**Files:**
- Create: `packages/web/app/studio/page.tsx` (server shell, Google-configured gate — mirror `app/sorter/page.tsx`)
- Create: `packages/web/app/studio/StudioClient.tsx` (stepped client UI)
- Verify: `packages/web/app/page.tsx:16` already links `href="/studio"` — it stops being a dead link once the route exists.

**Interfaces:**
- Consumes: `GET /api/drive/folders`, `GET /api/studio/images?folderId=`, `GET /api/studio/drive-thumb/[fileId]`, `POST /api/studio/headshots`, `GET /api/studio/headshots/[id]`, `FRAME_LIST` from `@event-editor/core/frames`.

- [ ] **Step 1: Implement the server shell**

`packages/web/app/studio/page.tsx`:

```tsx
import { getConnections } from "@event-editor/core/settings";
import { StudioClient } from "./StudioClient";

export default function StudioPage() {
  const google = getConnections().find((c) => c.id === "google");
  return (
    <div>
      <p className="eyebrow">Headshot studio</p>
      <h1 className="mt-1 text-2xl font-semibold">Turn a Drive photo into a branded headshot</h1>
      {!google?.configured ? (
        <div className="card mt-8">
          <p className="text-muted">Google credentials are not set in your environment yet.</p>
          <p className="mt-2 text-muted">Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env, then restart.</p>
        </div>
      ) : (
        <StudioClient />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implement the stepped client**

`packages/web/app/studio/StudioClient.tsx` — follow `SorterClient.tsx` conventions (same fetch/poll shape, same `card`/`btn`/`btn-accent`/`eyebrow` classes, anti-vibecode: one accent, neutral rest, soft shadows, sentence-case, no em dashes):

```tsx
"use client";
import { useEffect, useState } from "react";
import { FRAME_LIST } from "@event-editor/core/frames";

interface Folder { id: string; name: string; }
interface DriveImg { id: string; name: string; }
interface Headshot { id: number; status: string; imageUrl: string | null; errorMessage: string | null; }

export function StudioClient() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderId, setFolderId] = useState("");
  const [images, setImages] = useState<DriveImg[]>([]);
  const [fileId, setFileId] = useState("");
  const [frameId, setFrameId] = useState(FRAME_LIST[0]?.id ?? "");
  const [nameText, setNameText] = useState("");
  const [titleText, setTitleText] = useState("");
  const [busy, setBusy] = useState(false);
  const [hsId, setHsId] = useState<number | null>(null);
  const [hs, setHs] = useState<Headshot | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/drive/folders").then(async (r) => {
      if (r.status === 401) { setConnected(false); return; }
      setConnected(true);
      setFolders((await r.json()).folders ?? []);
    }).catch(() => setConnected(false));
  }, []);

  useEffect(() => {
    if (!folderId) { setImages([]); return; }
    setFileId("");
    fetch(`/api/studio/images?folderId=${encodeURIComponent(folderId)}`)
      .then((r) => r.json()).then((d) => setImages(d.images ?? [])).catch(() => setImages([]));
  }, [folderId]);

  useEffect(() => {
    if (hsId == null) return;
    let stop = false;
    const loop = async () => {
      while (!stop) {
        const r = await fetch(`/api/studio/headshots/${hsId}`);
        if (r.ok) {
          const d = await r.json();
          setHs(d.headshot);
          if (d.headshot.status === "done" || d.headshot.status === "error") break;
        }
        await new Promise((res) => setTimeout(res, 1000));
      }
    };
    loop();
    return () => { stop = true; };
  }, [hsId]);

  async function generate() {
    if (!fileId || !frameId) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/studio/headshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driveFileId: fileId, frameId, nameText, titleText }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "failed to start");
      setHsId(d.id); setHs(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
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
    <div className="mt-8 space-y-6">
      <div className="card">
        <p className="eyebrow">Step 1 — choose a photo</p>
        <select
          className="mt-3 rounded-lg border border-line bg-surface px-3 py-2"
          value={folderId}
          onChange={(e) => setFolderId(e.target.value)}
        >
          <option value="">Choose a folder</option>
          {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        {images.length > 0 && (
          <div className="mt-4 grid grid-cols-4 gap-3">
            {images.map((img) => (
              <button
                key={img.id}
                onClick={() => setFileId(img.id)}
                className={`overflow-hidden rounded-lg border ${fileId === img.id ? "border-accent" : "border-line"}`}
                title={img.name}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/studio/drive-thumb/${img.id}`} alt={img.name} className="aspect-square w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <p className="eyebrow">Step 2 — pick a frame</p>
        <div className="mt-3 flex flex-wrap gap-3">
          {FRAME_LIST.map((f) => (
            <button
              key={f.id}
              onClick={() => setFrameId(f.id)}
              className={`btn ${frameId === f.id ? "btn-accent" : ""}`}
            >
              {f.label}
            </button>
          ))}
          <span className="self-center text-muted">Canva brand templates — coming soon</span>
        </div>
      </div>

      <div className="card">
        <p className="eyebrow">Step 3 — details</p>
        <div className="mt-3 flex flex-col gap-3 sm:max-w-md">
          <input className="rounded-lg border border-line bg-surface px-3 py-2" placeholder="Name"
            value={nameText} onChange={(e) => setNameText(e.target.value)} />
          <input className="rounded-lg border border-line bg-surface px-3 py-2" placeholder="Title"
            value={titleText} onChange={(e) => setTitleText(e.target.value)} />
        </div>
        <button className="btn btn-accent mt-4" onClick={generate} disabled={!fileId || busy}>
          {busy ? "Starting…" : "Generate headshot"}
        </button>
        {err && <p className="mt-3 text-muted">{err}</p>}
      </div>

      {hs && (
        <div className="card">
          <p className="eyebrow">Result</p>
          {hs.status === "error" ? (
            <p className="mt-3 text-muted">Render failed: {hs.errorMessage}</p>
          ) : hs.status === "done" && hs.imageUrl ? (
            <div className="mt-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={hs.imageUrl} alt="headshot" className="w-72 rounded-lg border border-line" />
              <a className="btn btn-accent mt-4" href={hs.imageUrl} download={`headshot-${hs.id}.png`}>Download PNG</a>
            </div>
          ) : (
            <p className="mt-3 text-muted">Rendering…</p>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Build + manual verification**

```bash
npm -w @event-editor/core run migrate   # add the new headshots columns to the dev db
npm run build                            # repo root; must be clean
npm run dev                              # then exercise /studio in the browser
```

Expected: `/studio` returns 200 (not a dead link from the landing page). With Google connected: pick folder → thumbnails load → pick a photo → pick a frame → enter name/title → Generate → status polls `rendering` → result PNG renders and downloads. Confirm the circle frame produces a centered circular crop.

- [ ] **Step 4: Commit**

```bash
git add packages/web/app/studio
git commit -m "feat(web): /studio stepped UI for local headshot rendering"
```

---

## Self-Review

**Spec coverage:**
- §1 schema generalization → Task 1 (renderer, nullable canva id, template_id, output_path, status union, guarded idempotent migration, drift test). `source_drive_file_id` added beyond the spec's enumerated columns because the async render must recover the Drive file id from the row — noted to the user as a refinement.
- §2 Drive source + full-res fetch → Task 6 (`downloadFile`) + Task 9 (folder images + `thumbnailFor` for the picker grid).
- §3 render pipeline + API → Task 3 (core pipeline), Task 7 (glue), Task 8 (POST/GET/list/image with path containment).
- §4 frames (1080² square, center-crop, 3 frames incl. circle, text risk) → Task 2 (specs) + Task 5 (sharp composite, circle mask) + Task 4 (DM Sans via text-to-path, which is the spec's robust fallback chosen up front to remove the font risk).
- §5 `/studio` UI (stepped, Canva "coming soon", activate landing link) → Task 10.
- Out-of-scope items (Canva, sorter handoff, portrait, batch) → not implemented, correct.
- Testing section (core render stub, migration idempotency, routes, containment) → covered across Tasks 1/3/5/7/8.

**Placeholder scan:** none — every code step is concrete. The only manual external step is supplying `DMSans-Medium.ttf` (Task 4), which is an asset acquisition, not a code placeholder.

**Type consistency:** `FrameSpec`/`TextLine` defined in Task 2 are consumed verbatim in Tasks 3/5. `HeadshotRenderDeps` (Task 3) matches the deps object built in Task 7. `createHeadshot`/`runHeadshotRender`/`startHeadshot`/`renderHeadshot`/`glyphPath`/`downloadFile`/`thumbnailFor` signatures are identical at definition and call sites. DTO shape (`imageUrl` derived from `status==="done"`) is the same in the list route and the status route.

**Decision flagged for the user:** §1 of the spec didn't list `source_drive_file_id`; the plan adds it (Task 1) because the async pipeline needs to persist which Drive file to download. Calling it out explicitly.
