# Past-runs history panels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the photo sorter, headshot studio, and slide slicer a "See past ..." history dropdown mirroring the transcriber's, using one shared generic panel component.

**Architecture:** Extract the transcriber panel's mechanics into a generic `HistoryPanel` component. Sorter and studio already persist runs (`jobs`, `headshots`), so they just add a list GET + a DELETE and a thin panel. The slicer is ephemeral, so it gets a new `slice_runs` metadata table + core module; the history marks swept runs as "expired". No in-app "Open", no pagination.

**Tech Stack:** Next.js 16 (App Router), React 19, better-sqlite3 + drizzle, Vitest.

## Global Constraints

- Monorepo `packages/core` (logic + DB) + `packages/web`. Core tests: `npm -w @event-editor/core test`. Web tsc: from `packages/web`, `npx tsc --noEmit`. Web tests: `npm test`.
- **After core source changes, rebuild core** (`npm -w @event-editor/core run build`). Any new core module web imports needs BOTH a barrel export in `src/index.ts` AND a `package.json` subpath entry (`dist/` is gitignored).
- Two dev DBs: root `data/app.db` and `packages/web/data/app.db` (dev server runs from `packages/web`). Migrate the web one with `EE_DB_PATH="$PWD/packages/web/data/app.db" npm -w @event-editor/core run migrate`.
- tsc caveat: `packages/web` has 5 PRE-EXISTING tsc errors in `test/docs.test.ts` + `test/canva-oauth.test.ts`. "Clean" = no NEW errors from the task's own files.
- No new runtime dependency.
- Anti-vibecode: reuse `card` / `btn` / `eyebrow` / `StatusBadge`; single card (no nesting); status badge is the only semantic colour; sentence-case; no em dashes; Delete is a two-step inline confirm (no native `confirm()`).
- Core DB test setup pattern: `openDb(join(tmpdir(), \`ee-<tag>-${Math.random().toString(36).slice(2)}.db\`))` then `runMigrations(db)`; import from `../src/index.js`.

---

### Task 1: Core slice_runs table + module

**Files:**
- Modify: `packages/core/src/schema/index.ts` (add `sliceRuns`)
- Modify: `packages/core/src/migrate.ts` (DDL)
- Create: `packages/core/src/slice-runs.ts`
- Modify: `packages/core/src/index.ts` (barrel export)
- Modify: `packages/core/package.json` (subpath export)
- Test: `packages/core/test/slice-runs.test.ts`

**Interfaces:**
- Produces: table `sliceRuns { runId (PK), sourceFilename, status, createdAt }`;
  `interface SliceRunRow { runId: string; sourceFilename: string; status: string; createdAt: number }`;
  `createSliceRun(db, { runId, sourceFilename }): void` (status "converted"),
  `markSliceRunSliced(db, runId): void`, `listSliceRuns(db): SliceRunRow[]` (createdAt desc),
  `deleteSliceRun(db, runId): void`. Importable at `@event-editor/core/slice-runs`.

- [ ] **Step 1: Add the schema**

In `packages/core/src/schema/index.ts`, append:
```ts
export const sliceRuns = sqliteTable("slice_runs", {
  runId: text("run_id").primaryKey(),
  sourceFilename: text("source_filename").notNull(),
  status: text("status").notNull(), // converted|sliced
  createdAt: integer("created_at").notNull().default(0),
});
```

- [ ] **Step 2: Add the migration**

In `packages/core/src/migrate.ts`, append to the `DDL` array:
```ts
  `CREATE TABLE IF NOT EXISTS slice_runs (
    run_id TEXT PRIMARY KEY,
    source_filename TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT 0
  )`,
```

- [ ] **Step 3: Write the failing test**

Create `packages/core/test/slice-runs.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { openDb, runMigrations } from "../src/index.js";
import { createSliceRun, markSliceRunSliced, listSliceRuns, deleteSliceRun } from "../src/slice-runs.js";

function freshDb() {
  const db = openDb(join(tmpdir(), `ee-sr-${Math.random().toString(36).slice(2)}.db`));
  runMigrations(db);
  return db;
}

describe("slice-runs", () => {
  it("is empty by default", () => {
    expect(listSliceRuns(freshDb())).toEqual([]);
  });
  it("creates a run with status converted and lists it", () => {
    const db = freshDb();
    createSliceRun(db, { runId: "r1", sourceFilename: "deck.pptx" });
    const rows = listSliceRuns(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ runId: "r1", sourceFilename: "deck.pptx", status: "converted" });
  });
  it("marks a run sliced", () => {
    const db = freshDb();
    createSliceRun(db, { runId: "r1", sourceFilename: "deck.pptx" });
    markSliceRunSliced(db, "r1");
    expect(listSliceRuns(db)[0].status).toBe("sliced");
  });
  it("orders newest first by createdAt", () => {
    const db = freshDb();
    createSliceRun(db, { runId: "old", sourceFilename: "a.pptx" });
    createSliceRun(db, { runId: "new", sourceFilename: "b.pptx" });
    // both get Date.now(); force a deterministic ordering by bumping created_at
    db.run(sql.raw("UPDATE slice_runs SET created_at = 1 WHERE run_id = 'old'"));
    db.run(sql.raw("UPDATE slice_runs SET created_at = 2 WHERE run_id = 'new'"));
    expect(listSliceRuns(db).map((r) => r.runId)).toEqual(["new", "old"]);
  });
  it("deletes a run", () => {
    const db = freshDb();
    createSliceRun(db, { runId: "r1", sourceFilename: "deck.pptx" });
    deleteSliceRun(db, "r1");
    expect(listSliceRuns(db)).toEqual([]);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm -w @event-editor/core test -- slice-runs`
Expected: FAIL — cannot resolve `../src/slice-runs.js`.

- [ ] **Step 5: Write the module**

Create `packages/core/src/slice-runs.ts`:
```ts
import { desc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { sliceRuns } from "./schema/index.js";

export interface SliceRunRow {
  runId: string;
  sourceFilename: string;
  status: string;
  createdAt: number;
}

export function createSliceRun(
  db: BetterSQLite3Database<any>,
  args: { runId: string; sourceFilename: string },
): void {
  db.insert(sliceRuns)
    .values({ runId: args.runId, sourceFilename: args.sourceFilename, status: "converted", createdAt: Date.now() })
    .onConflictDoNothing()
    .run();
}

export function markSliceRunSliced(db: BetterSQLite3Database<any>, runId: string): void {
  db.update(sliceRuns).set({ status: "sliced" }).where(eq(sliceRuns.runId, runId)).run();
}

export function listSliceRuns(db: BetterSQLite3Database<any>): SliceRunRow[] {
  return db.select().from(sliceRuns).orderBy(desc(sliceRuns.createdAt)).all();
}

export function deleteSliceRun(db: BetterSQLite3Database<any>, runId: string): void {
  db.delete(sliceRuns).where(eq(sliceRuns.runId, runId)).run();
}
```

- [ ] **Step 6: Barrel export + subpath**

In `packages/core/src/index.ts` add:
```ts
export * from "./slice-runs.js";
```
In `packages/core/package.json`, add to the `exports` map (match the existing plain-string subpath form, e.g. next to `"./ranking-context"`):
```json
"./slice-runs": "./dist/slice-runs.js",
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm -w @event-editor/core test -- slice-runs`
Expected: PASS (5 tests).

- [ ] **Step 8: Rebuild core + full core suite**

Run: `npm -w @event-editor/core run build && npm -w @event-editor/core test`
Expected: build ok; full core suite green (drift/schema/migrate tests still pass with the new table).

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/schema/index.ts packages/core/src/migrate.ts \
  packages/core/src/slice-runs.ts packages/core/src/index.ts \
  packages/core/package.json packages/core/test/slice-runs.test.ts
git commit -m "feat(core): slice_runs table + module for slice history"
```

---

### Task 2: Shared HistoryPanel component

**Files:**
- Create: `packages/web/components/HistoryPanel.tsx`

**Interfaces:**
- Produces: `HistoryPanel<T extends { id: string | number }>(props)` and `historyWhen(ms): string`.
  Props: `buttonLabel`, `panelTitle`, `emptyLabel`, `fetchItems(): Promise<T[]>`,
  `renderRow(item): ReactNode`, `renderActions?(item): ReactNode`, `deleteItem?(item): Promise<void>`.

- [ ] **Step 1: Write the component**

Create `packages/web/components/HistoryPanel.tsx`:
```tsx
"use client";
import { useState, type ReactNode } from "react";

export interface HistoryItem {
  id: string | number;
}

export function historyWhen(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function HistoryPanel<T extends HistoryItem>({
  buttonLabel,
  panelTitle,
  emptyLabel,
  fetchItems,
  renderRow,
  renderActions,
  deleteItem,
}: {
  buttonLabel: string;
  panelTitle: string;
  emptyLabel: string;
  fetchItems: () => Promise<T[]>;
  renderRow: (item: T) => ReactNode;
  renderActions?: (item: T) => ReactNode;
  deleteItem?: (item: T) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<T[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmingId, setConfirmingId] = useState<T["id"] | null>(null);
  const [deletingId, setDeletingId] = useState<T["id"] | null>(null);
  const [rowError, setRowError] = useState<{ id: T["id"]; message: string } | null>(null);

  async function reload() {
    setLoading(true);
    setRowError(null);
    try {
      setItems(await fetchItems());
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) reload();
  }

  async function doDelete(item: T) {
    if (!deleteItem) return;
    setDeletingId(item.id);
    setRowError(null);
    try {
      await deleteItem(item);
      setConfirmingId(null);
      await reload();
    } catch {
      setRowError({ id: item.id, message: "Could not delete." });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="relative">
      <button className="btn" onClick={toggle} aria-expanded={open}>{buttonLabel}</button>
      {open && (
        <>
          <button
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="card absolute right-0 z-20 mt-2 w-[420px]">
            <p className="eyebrow">{panelTitle}</p>
            {loading && <p className="mt-3 text-sm text-muted">Loading…</p>}
            {!loading && items && items.length === 0 && <p className="mt-3 text-sm text-muted">{emptyLabel}</p>}
            {!loading && items && items.length > 0 && (
              <ul className="mt-3 max-h-[420px] divide-y divide-line/60 overflow-y-auto pr-1">
                {items.map((item) => {
                  const rowBusy = deletingId === item.id;
                  return (
                    <li key={String(item.id)} className="py-3 first:pt-0 last:pb-0">
                      {renderRow(item)}
                      {(renderActions || deleteItem) && (
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          {renderActions?.(item)}
                          {deleteItem &&
                            (confirmingId === item.id ? (
                              <span className="flex items-center gap-2 text-xs">
                                <span className="text-danger">Delete?</span>
                                <button
                                  type="button"
                                  className="text-danger underline underline-offset-2 disabled:pointer-events-none disabled:opacity-50"
                                  onClick={() => doDelete(item)}
                                  disabled={rowBusy}
                                >
                                  {rowBusy ? "Deleting…" : "Yes"}
                                </button>
                                <button
                                  type="button"
                                  className="text-ink underline underline-offset-2 disabled:pointer-events-none disabled:opacity-50"
                                  onClick={() => setConfirmingId(null)}
                                  disabled={rowBusy}
                                >
                                  No
                                </button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="text-xs text-danger underline underline-offset-2 disabled:pointer-events-none disabled:opacity-50"
                                onClick={() => setConfirmingId(item.id)}
                                disabled={rowBusy}
                              >
                                Delete
                              </button>
                            ))}
                        </div>
                      )}
                      {rowError?.id === item.id && <p className="mt-2 text-xs text-danger">{rowError.message}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run (from `packages/web`): `npx tsc --noEmit`
Expected: no new errors (the component is generic and unconsumed yet).

- [ ] **Step 3: Commit**

```bash
git add packages/web/components/HistoryPanel.tsx
git commit -m "feat(web): shared HistoryPanel dropdown component"
```

---

### Task 3: Sorter "See past scans"

**Files:**
- Modify: `packages/web/app/api/sorter/jobs/route.ts` (add GET list)
- Modify: `packages/web/app/api/sorter/jobs/[id]/route.ts` (add DELETE)
- Create: `packages/web/app/sorter/PastScans.tsx`
- Modify: `packages/web/app/sorter/page.tsx` (header wrap + panel)

**Interfaces:**
- Consumes: `HistoryPanel`, `historyWhen` (Task 2); `jobStatusView` from `@/lib/status`; `StatusBadge`.

- [ ] **Step 1: Add the GET list to the jobs route**

In `packages/web/app/api/sorter/jobs/route.ts`, add imports and a GET handler (keep the existing POST):
```ts
import { desc } from "drizzle-orm";
import { jobs } from "@event-editor/core/schema";
```
```ts
export async function GET() {
  const rows = getDb().select().from(jobs).orderBy(desc(jobs.createdAt)).all();
  return NextResponse.json({
    jobs: rows.map((r) => ({
      id: r.id,
      driveFolderName: r.driveFolderName,
      platform: r.platform,
      status: r.status,
      total: r.total,
      processed: r.processed,
      createdAt: r.createdAt,
    })),
  });
}
```
(`getDb` and `NextResponse` are already imported in this file.)

- [ ] **Step 2: Add DELETE to the single-job route**

In `packages/web/app/api/sorter/jobs/[id]/route.ts`, add imports + a DELETE handler (keep the existing GET; `jobs`, `photos`, `eq`, `getDb`, `NextResponse` are already imported):
```ts
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { thumbsDir } from "@/lib/paths";
```
```ts
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = Number(id);
  const db = getDb();
  db.delete(photos).where(eq(photos.jobId, jobId)).run();
  db.delete(jobs).where(eq(jobs.id, jobId)).run();
  await rm(resolve(thumbsDir(), String(jobId)), { recursive: true, force: true }).catch(() => {});
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Write the panel**

Create `packages/web/app/sorter/PastScans.tsx`:
```tsx
"use client";
import { HistoryPanel, historyWhen } from "@/components/HistoryPanel";
import { StatusBadge } from "@/components/StatusBadge";
import { jobStatusView } from "@/lib/status";

interface Scan {
  id: number;
  driveFolderName: string;
  platform: string | null;
  status: string;
  total: number;
  processed: number;
  createdAt: number;
}

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  linkedin: "LinkedIn",
  profile: "Profile picture",
};

export function PastScans() {
  return (
    <HistoryPanel<Scan>
      buttonLabel="See past scans"
      panelTitle="Recent scans"
      emptyLabel="No scans yet."
      fetchItems={async () => {
        const r = await fetch("/api/sorter/jobs");
        const d = await r.json().catch(() => null);
        return d?.jobs ?? [];
      }}
      deleteItem={async (it) => {
        const r = await fetch(`/api/sorter/jobs/${it.id}`, { method: "DELETE" });
        if (!r.ok) throw new Error();
      }}
      renderRow={(it) => (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm text-ink">{it.driveFolderName}</span>
            <StatusBadge {...jobStatusView(it.status)} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>{historyWhen(it.createdAt)}</span>
            {it.platform && PLATFORM_LABEL[it.platform] && <span>· {PLATFORM_LABEL[it.platform]}</span>}
            <span>· {it.processed} of {it.total}</span>
          </div>
        </>
      )}
    />
  );
}
```

- [ ] **Step 4: Wrap the sorter page header + render the panel**

In `packages/web/app/sorter/page.tsx`:
- Add `import { PastScans } from "./PastScans";`
- Replace the `<p className="eyebrow">...` + `<h1>...` pair with:
```tsx
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="eyebrow">Photo sorter</p>
          <h1 className="mt-1 text-2xl font-semibold">Rank Drive photos for LinkedIn</h1>
        </div>
        <PastScans />
      </div>
```

- [ ] **Step 5: Typecheck**

Run (from `packages/web`): `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Manual verify**

Run (from `packages/web`): `npm run dev`, open `/sorter`. "See past scans" appears beside the heading; the panel lists prior scans (folder, status badge, date, platform, N of M); Delete confirms and removes a scan. Empty state "No scans yet." shows when there are none. Do not leave a dev server running.

- [ ] **Step 7: Commit**

```bash
git add packages/web/app/api/sorter/jobs/route.ts \
  "packages/web/app/api/sorter/jobs/[id]/route.ts" \
  packages/web/app/sorter/PastScans.tsx packages/web/app/sorter/page.tsx
git commit -m "feat(web): sorter see-past-scans history panel"
```

---

### Task 4: Studio "See past headshots"

**Files:**
- Modify: `packages/web/lib/headshot-dto.ts` (extend DTO)
- Modify: `packages/web/app/api/studio/headshots/[id]/route.ts` (add DELETE)
- Create: `packages/web/app/studio/PastHeadshots.tsx`
- Modify: `packages/web/app/studio/page.tsx` (header wrap + panel)

**Interfaces:**
- Consumes: `GET /api/studio/headshots` (existing, returns `{ headshots: dto[] }`); `HistoryPanel`, `historyWhen`; `headshotStatusView`; `StatusBadge`.

- [ ] **Step 1: Extend the headshot DTO**

Replace `packages/web/lib/headshot-dto.ts` with:
```ts
import type { Headshot } from "@event-editor/core/types";

// Shared serializer so the list route and the single-row route never drift.
export function toHeadshotDto(r: Headshot) {
  const imageUrl = r.status === "done" ? `/api/studio/image/${r.id}` : null;
  return {
    id: r.id,
    status: r.status,
    templateId: r.templateId,
    nameText: r.nameText,
    titleText: r.titleText,
    errorMessage: r.errorMessage,
    imageUrl,
    createdAt: r.createdAt,
    renderer: r.renderer,
    source: r.source,
    downloadUrl: r.status === "done" ? (r.renderer === "canva" ? r.exportUrl : imageUrl) : null,
  };
}
```

- [ ] **Step 2: Add DELETE to the single-headshot route**

In `packages/web/app/api/studio/headshots/[id]/route.ts`, add an import + DELETE (keep the existing GET; `headshots`, `eq`, `getDb`, `NextResponse` already imported):
```ts
import { rm } from "node:fs/promises";
```
```ts
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const r = db.select().from(headshots).where(eq(headshots.id, Number(id))).all()[0];
  if (r?.outputPath) await rm(r.outputPath, { force: true }).catch(() => {});
  db.delete(headshots).where(eq(headshots.id, Number(id))).run();
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Write the panel**

Create `packages/web/app/studio/PastHeadshots.tsx`:
```tsx
"use client";
import { HistoryPanel, historyWhen } from "@/components/HistoryPanel";
import { StatusBadge } from "@/components/StatusBadge";
import { headshotStatusView } from "@/lib/status";

interface Shot {
  id: number;
  status: string;
  nameText: string | null;
  titleText: string | null;
  imageUrl: string | null;
  downloadUrl: string | null;
  createdAt: number;
  renderer: string;
  source: string;
}

export function PastHeadshots() {
  return (
    <HistoryPanel<Shot>
      buttonLabel="See past headshots"
      panelTitle="Recent headshots"
      emptyLabel="No headshots yet."
      fetchItems={async () => {
        const r = await fetch("/api/studio/headshots");
        const d = await r.json().catch(() => null);
        return d?.headshots ?? [];
      }}
      deleteItem={async (it) => {
        const r = await fetch(`/api/studio/headshots/${it.id}`, { method: "DELETE" });
        if (!r.ok) throw new Error();
      }}
      renderRow={(it) => (
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="block truncate text-sm text-ink">{it.nameText || "Untitled"}</span>
            {it.titleText && <span className="block truncate text-xs text-muted">{it.titleText}</span>}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>{historyWhen(it.createdAt)}</span>
              <span>· {it.renderer === "canva" ? "Canva" : "Local"}</span>
              <StatusBadge {...headshotStatusView(it.status)} />
            </div>
          </div>
          {it.imageUrl && <img src={it.imageUrl} alt="" className="h-10 w-10 flex-none rounded-md object-cover" />}
        </div>
      )}
      renderActions={(it) =>
        it.downloadUrl ? (
          <a className="text-xs text-ink underline underline-offset-2" href={it.downloadUrl} target="_blank" rel="noreferrer">
            Download
          </a>
        ) : null
      }
    />
  );
}
```

- [ ] **Step 4: Wrap the studio page header + render the panel**

In `packages/web/app/studio/page.tsx`:
- Add `import { PastHeadshots } from "./PastHeadshots";`
- Replace the `<p className="eyebrow">...` + `<h1>...` pair with:
```tsx
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="eyebrow">Headshot studio</p>
          <h1 className="mt-1 text-2xl font-semibold">Build branded headshots</h1>
        </div>
        <PastHeadshots />
      </div>
```
(This sits above `StudioTabs`, spanning both tabs.)

- [ ] **Step 5: Typecheck**

Run (from `packages/web`): `npx tsc --noEmit`
Expected: no new errors. In particular the extended DTO must line up with the `Headshot` type fields (`createdAt`, `renderer`, `source`, `exportUrl` all exist on the schema row).

- [ ] **Step 6: Manual verify**

Run (from `packages/web`): `npm run dev`, open `/studio`. "See past headshots" appears in the header above the Single/Batch tabs; the panel lists prior headshots (name/title, status badge, thumbnail when done, date, renderer); Download opens the render; Delete removes one. Do not leave a dev server running.

- [ ] **Step 7: Commit**

```bash
git add packages/web/lib/headshot-dto.ts \
  "packages/web/app/api/studio/headshots/[id]/route.ts" \
  packages/web/app/studio/PastHeadshots.tsx packages/web/app/studio/page.tsx
git commit -m "feat(web): studio see-past-headshots history panel"
```

---

### Task 5: Slice history persistence + routes

**Files:**
- Modify: `packages/web/app/api/slice/convert/route.ts` (record run)
- Modify: `packages/web/app/api/slice/export/route.ts` (mark sliced)
- Create: `packages/web/app/api/slice/runs/route.ts` (GET list)
- Create: `packages/web/app/api/slice/runs/[runId]/route.ts` (DELETE)

**Interfaces:**
- Consumes: `createSliceRun`, `markSliceRunSliced`, `listSliceRuns`, `deleteSliceRun` from `@event-editor/core/slice-runs` (Task 1); `runDir`, `cleanupRun` from `@/lib/slice`.
- Produces: `GET /api/slice/runs` → `{ runs: { runId, sourceFilename, status, createdAt, expired }[] }`; `DELETE /api/slice/runs/[runId]`.

- [ ] **Step 1: Record the run on convert**

In `packages/web/app/api/slice/convert/route.ts`:
- Add `import { createSliceRun } from "@event-editor/core/slice-runs";` (`getDb` is already imported).
- Immediately before the success `return NextResponse.json({ runId, pageCount, slides, filename, warnings });`, add:
```ts
    createSliceRun(getDb(), { runId, sourceFilename: filename });
```

- [ ] **Step 2: Mark the run sliced on export**

In `packages/web/app/api/slice/export/route.ts`:
- Add imports: `import { getDb } from "@/lib/db";` and `import { markSliceRunSliced } from "@event-editor/core/slice-runs";`
- After the loop that writes the outputs (`for (const o of outputs) await writeFile(...)`), before the `return NextResponse.json({ files: ... })`, add:
```ts
    markSliceRunSliced(getDb(), runId);
```

- [ ] **Step 3: Write the runs list route**

Create `packages/web/app/api/slice/runs/route.ts`:
```ts
import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { listSliceRuns } from "@event-editor/core/slice-runs";
import { getDb } from "@/lib/db";
import { runDir } from "@/lib/slice";

export const runtime = "nodejs";

export async function GET() {
  const rows = listSliceRuns(getDb());
  return NextResponse.json({
    runs: rows.map((r) => ({
      runId: r.runId,
      sourceFilename: r.sourceFilename,
      status: r.status,
      createdAt: r.createdAt,
      expired: !existsSync(runDir(r.runId)),
    })),
  });
}
```

- [ ] **Step 4: Write the runs delete route**

Create `packages/web/app/api/slice/runs/[runId]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { deleteSliceRun } from "@event-editor/core/slice-runs";
import { getDb } from "@/lib/db";
import { cleanupRun } from "@/lib/slice";

export const runtime = "nodejs";

export async function DELETE(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  deleteSliceRun(getDb(), runId);
  try {
    await cleanupRun(runId);
  } catch {
    /* best-effort file cleanup */
  }
  return NextResponse.json({ ok: true });
}
```
(If `cleanupRun` is synchronous, `await` on a non-promise is harmless. Confirm its signature in `packages/web/lib/slice.ts`; it is used elsewhere as `cleanupRun(runId)`.)

- [ ] **Step 5: Rebuild core (subpath) + typecheck web**

Run: `npm -w @event-editor/core run build` then, from `packages/web`, `npx tsc --noEmit`
Expected: `@event-editor/core/slice-runs` resolves; no new errors from the four touched files.

- [ ] **Step 6: Migrate the web dev DB + smoke test**

Run: `EE_DB_PATH="$PWD/packages/web/data/app.db" npm -w @event-editor/core run migrate` (from repo root), then from `packages/web` `npm run dev` and `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/slice/runs` → expect `200` (empty `{runs:[]}` on a fresh DB). Do not leave a dev server running.

- [ ] **Step 7: Commit**

```bash
git add packages/web/app/api/slice/convert/route.ts \
  packages/web/app/api/slice/export/route.ts \
  packages/web/app/api/slice/runs/route.ts \
  "packages/web/app/api/slice/runs/[runId]/route.ts"
git commit -m "feat(web): persist slice runs + list/delete routes"
```

---

### Task 6: Slice "See past slices" panel

**Files:**
- Create: `packages/web/app/slice/PastSlices.tsx`
- Modify: `packages/web/app/slice/page.tsx` (header wrap + panel)

**Interfaces:**
- Consumes: `GET /api/slice/runs`, `DELETE /api/slice/runs/[runId]` (Task 5); `HistoryPanel`, `historyWhen`; `StatusBadge`.

- [ ] **Step 1: Write the panel**

Create `packages/web/app/slice/PastSlices.tsx`:
```tsx
"use client";
import { HistoryPanel, historyWhen } from "@/components/HistoryPanel";
import { StatusBadge } from "@/components/StatusBadge";

interface Run {
  runId: string;
  sourceFilename: string;
  status: string;
  createdAt: number;
  expired: boolean;
}
type RunItem = Run & { id: string };

function badge(r: Run): { tone: "idle" | "active" | "success" | "error"; label: string } {
  if (r.expired) return { tone: "idle", label: "Expired" };
  if (r.status === "sliced") return { tone: "success", label: "Sliced" };
  return { tone: "idle", label: "Converted" };
}

export function PastSlices() {
  return (
    <HistoryPanel<RunItem>
      buttonLabel="See past slices"
      panelTitle="Recent slices"
      emptyLabel="No slices yet."
      fetchItems={async () => {
        const r = await fetch("/api/slice/runs");
        const d = await r.json().catch(() => null);
        return (d?.runs ?? []).map((x: Run) => ({ ...x, id: x.runId }));
      }}
      deleteItem={async (it) => {
        const r = await fetch(`/api/slice/runs/${encodeURIComponent(it.runId)}`, { method: "DELETE" });
        if (!r.ok) throw new Error();
      }}
      renderRow={(it) => (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm text-ink">{it.sourceFilename}</span>
            <StatusBadge {...badge(it)} />
          </div>
          <div className="mt-1 text-xs text-muted">{historyWhen(it.createdAt)}</div>
        </>
      )}
      renderActions={(it) =>
        it.status === "sliced" && !it.expired ? (
          <a
            className="text-xs text-ink underline underline-offset-2"
            href={`/api/slice/${encodeURIComponent(it.runId)}/zip`}
            target="_blank"
            rel="noreferrer"
          >
            Download zip
          </a>
        ) : null
      }
    />
  );
}
```

- [ ] **Step 2: Wrap the slice page header + render the panel**

In `packages/web/app/slice/page.tsx`:
- Add `import { PastSlices } from "./PastSlices";`
- Replace the `<p className="eyebrow">...` + `<h1>...` pair with:
```tsx
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="eyebrow">Slide slicer</p>
          <h1 className="mt-1 text-2xl font-semibold">Slice a deck into confidential PDFs</h1>
        </div>
        <PastSlices />
      </div>
```

- [ ] **Step 3: Typecheck**

Run (from `packages/web`): `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual verify**

Run (from `packages/web`): `npm run dev`, open `/slice`. "See past slices" appears beside the heading. After running a real slice (convert + export), the run shows with "Sliced" and a "Download zip" link; a convert-only run shows "Converted" with no download; runs whose files were swept show "Expired". Delete removes the log row. Empty state "No slices yet." shows initially. Do not leave a dev server running.

- [ ] **Step 5: Commit**

```bash
git add packages/web/app/slice/PastSlices.tsx packages/web/app/slice/page.tsx
git commit -m "feat(web): slice see-past-slices history panel"
```

---

## Self-review notes

- **Spec coverage:** shared panel → Task 2; sorter → Task 3; studio → Task 4; slice persistence → Tasks 1+5; slice panel → Task 6. All spec sections covered.
- **Type consistency:** `HistoryPanel<T>` prop names + `historyWhen` used identically in Tasks 3/4/6; `createSliceRun`/`markSliceRunSliced`/`listSliceRuns`/`deleteSliceRun` defined in Task 1, consumed in Task 5; DTO fields added in Task 4 Step 1 are consumed by the Task 4 panel.
- **Anti-vibecode:** single card per panel, StatusBadge is the only colour, sentence-case, no em dashes, two-step delete confirm.
- **DB safety:** `slice_runs` via `CREATE TABLE IF NOT EXISTS`; no column adds to existing tables. Both dev DBs need re-migration (Task 5 Step 6).
- **Subpath gotcha handled:** Task 1 Step 6 adds both the barrel export and the `package.json` subpath.
- **Known non-issue:** the sorter h1 still reads "Rank Drive photos for LinkedIn" (stale vs the new multi-platform sorter) — left unchanged, out of scope for this feature.
