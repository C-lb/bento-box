# Past-runs history panels for sorter, studio, slicer

Date: 2026-07-03
Package: `packages/web` + `packages/core`
Status: approved, ready to plan

## Problem

The transcriber has a "See past transcriptions" button in its page header that
opens a dropdown listing prior runs with status, date, and per-row actions. The
other three tools (photo sorter, headshot studio, slide slicer) have no such
history, even though the sorter and studio already persist their runs to the DB.
Users want the same at-a-glance history on all three.

## Goals

Add a "See past ..." history dropdown to the sorter, studio, and slicer, each
mirroring the transcriber's panel: a toggle button beside the page heading, an
anchored dropdown card with click-away, a scrollable list of prior runs (newest
first), each row showing an identity label, a status badge, a date, and per-row
actions. Delete uses the same two-step inline confirm.

Deviation from the transcriber, decided during brainstorming:
- **No in-app "Open".** The sorter and studio don't support loading a past run
  by URL, and adding that hydration is out of scope. Rows show status/date/
  identity, a download or external link where one exists, and Delete. No
  "Open/continue in the tool".
- **Slicer gets new persistence.** Slice runs are ephemeral (no DB record, files
  swept after ~6h). A new `slice_runs` metadata table records each run so the
  history can list it; runs whose files have been swept show as "expired" (no
  download, Delete still removes the log row).

Non-goals: pagination (the transcriber has none; lists stay small), in-app Open,
reversing the slicer's confidential auto-delete (files still sweep after 6h).

## Design

### Shared `HistoryPanel` component

Extract the transcriber panel's repeated mechanics into a generic client
component `packages/web/components/HistoryPanel.tsx`. It owns: the `btn` toggle,
the anchored dropdown card (`card absolute right-0 z-20 mt-2 w-[420px]`), the
full-screen click-away closer, fetch-on-open, loading/empty states, the
scrollable `divide-y` list, and per-row Delete with two-step inline confirm +
row error. Each tool supplies the label, the fetch, an optional delete, and how
to render a row's content.

```tsx
export interface HistoryItem { id: string | number }

export function HistoryPanel<T extends HistoryItem>(props: {
  buttonLabel: string;      // e.g. "See past scans"
  panelTitle: string;       // eyebrow, e.g. "Recent scans"
  emptyLabel: string;       // e.g. "No scans yet."
  fetchItems: () => Promise<T[]>;
  renderRow: (item: T) => React.ReactNode;       // identity line + badge + date/meta
  renderActions?: (item: T) => React.ReactNode;  // custom links (download/external), optional
  deleteItem?: (item: T) => Promise<void>;       // enables the standard Delete control
}): JSX.Element
```

Behaviour: `fetchItems` runs on open and after a successful delete. Per `<li>`
the panel renders `renderRow(item)`, then an actions row containing
`renderActions?.(item)` followed by the standard Delete control (only when
`deleteItem` is set), then the row error if delete failed. Delete state
(`confirmingId`, `deletingId`, `rowError`) is keyed by `item.id`, exactly as the
transcriber does it. Loading text "Loading…", empty text from `emptyLabel`.

`PastTranscriptions.tsx` is left unchanged (YAGNI, not refactored onto the shared
component). The three new panels are thin wrappers over `HistoryPanel`.

A shared `when(ms)` date formatter (short month + day, matching the transcriber)
lives in the component or a tiny helper; reuse `StatusBadge` +
`jobStatusView` / `headshotStatusView` from `lib/status.ts`.

### Sorter, "See past scans"

- **List route:** add a `GET` handler to `packages/web/app/api/sorter/jobs/route.ts`
  (currently POST-only): `db.select().from(jobs).orderBy(desc(jobs.createdAt)).all()`,
  mapped to `{ id, driveFolderName, platform, status, total, processed, createdAt }`.
- **Delete route:** new `packages/web/app/api/sorter/jobs/[id]/route.ts` `DELETE`
  handler (the file already has GET): delete `photos` where `jobId = id`, delete
  the `jobs` row, and `rm -rf` the job's thumbnail dir
  (`resolve(thumbsDir(), String(id))`, best-effort).
- **Panel** `packages/web/app/sorter/PastScans.tsx`: `buttonLabel="See past scans"`,
  fetch `GET /api/sorter/jobs`. Row: `driveFolderName` (truncated) +
  `StatusBadge {...jobStatusView(status)}`; meta line = `when(createdAt)`, a
  platform chip (`· Instagram` / `· LinkedIn` / `· Profile picture`; omit if
  null), and `· ${processed} of ${total}`. No custom actions (no download).
  `deleteItem` → `DELETE /api/sorter/jobs/${id}`.

### Studio, "See past headshots"

- **List route:** reuse the existing (currently unconsumed)
  `GET /api/studio/headshots` (last 24, `orderBy(desc(id))`). Extend
  `packages/web/lib/headshot-dto.ts` `toHeadshotDto` to also return `createdAt`,
  `renderer`, `source`, and `downloadUrl` (`imageUrl` for local done renders,
  else `exportUrl` for canva). Keep existing fields (the single-row route uses
  the same DTO, so nothing drifts).
- **Delete route:** new `packages/web/app/api/studio/headshots/[id]/route.ts`
  `DELETE` (the folder currently has GET/POST only at the collection level; add
  the `[id]` segment with a DELETE): delete the `headshots` row and `rm` its
  `outputPath` file if present (best-effort).
- **Panel** `packages/web/app/studio/PastHeadshots.tsx`: `buttonLabel="See past
  headshots"`, fetch `GET /api/studio/headshots`. Row: `nameText || "Untitled"`
  + `titleText` beneath (muted), `StatusBadge {...headshotStatusView(status)}`,
  a small thumbnail (`imageUrl`) when done, meta = `when(createdAt)` + a
  renderer/source chip (`· Canva` / `· Local`). `renderActions` = a "Download"
  link to `downloadUrl` when present. `deleteItem` → `DELETE
  /api/studio/headshots/${id}`.
- Placement: the studio page header (above the Single/Batch `StudioTabs`), so it
  spans both tabs.

### Slicer, "See past slices" (new persistence)

- **Schema** (`packages/core/src/schema/index.ts`): new table
  ```ts
  export const sliceRuns = sqliteTable("slice_runs", {
    runId: text("run_id").primaryKey(),
    sourceFilename: text("source_filename").notNull(),
    status: text("status").notNull(),       // "converted" | "sliced"
    createdAt: integer("created_at").notNull().default(0),
  });
  ```
- **Migration** (`packages/core/src/migrate.ts`): `CREATE TABLE IF NOT EXISTS
  slice_runs (...)` appended to `DDL`.
- **Core module** `packages/core/src/slice-runs.ts`: `createSliceRun(db,
  {runId, sourceFilename})` (status "converted", createdAt now),
  `markSliceRunSliced(db, runId)` (status → "sliced"),
  `listSliceRuns(db): SliceRunRow[]` (ordered by createdAt desc),
  `deleteSliceRun(db, runId)`. Exported from the core barrel AND registered as a
  `package.json` subpath `"./slice-runs": "./dist/slice-runs.js"` (the gotcha
  from the prior build: web imports core via subpaths and `dist/` is gitignored).
- **Write points:**
  - `POST /api/slice/convert` — after `runId`/`filename` are known and the
    conversion succeeds, `createSliceRun(getDb(), { runId, sourceFilename: filename })`.
  - the slice export route (the one that builds the per-slice PDFs + zip) —
    `markSliceRunSliced(getDb(), runId)` on success.
- **List route:** new `packages/web/app/api/slice/runs/route.ts` `GET`:
  `listSliceRuns(db)` mapped to `{ runId, sourceFilename, status, createdAt,
  expired }` where `expired = !existsSync(runDir(runId))` (true once the sweep
  removed the files).
- **Delete route:** new `packages/web/app/api/slice/runs/[runId]/route.ts`
  `DELETE`: `deleteSliceRun(db, runId)` then best-effort `cleanupRun(runId)`
  (existing helper) to remove any remaining files.
- **Panel** `packages/web/app/slice/PastSlices.tsx`: `buttonLabel="See past
  slices"`, fetch `GET /api/slice/runs`. Row: `sourceFilename` + a badge —
  `expired` shows a muted "Expired" chip (`tone: idle`), else `Sliced` (success)
  for status "sliced" or "Converted" (idle) for "converted"; meta =
  `when(createdAt)`. `renderActions` = a "Download zip" link to
  `/api/slice/${runId}/zip` shown only when `status === "sliced" && !expired`.
  `deleteItem` → `DELETE /api/slice/runs/${runId}`.
- A tiny status-view helper for slice-run rows can live in the panel (the
  existing `sliceStatusView` is keyed to live-job statuses, not
  converted/sliced/expired, so the panel maps its own three labels).

### Page headers

Each tool's page currently stacks `eyebrow` + `h1` with no header row. Wrap that
pair in `<div className="flex items-center justify-between gap-4">` and place the
panel component on the right, matching the transcriber (`transcribe/page.tsx`).
For studio the wrapper goes around the page-level heading, above `StudioTabs`.

## Files touched

**Core**
- `packages/core/src/schema/index.ts` — `sliceRuns` table.
- `packages/core/src/migrate.ts` — `slice_runs` DDL.
- `packages/core/src/slice-runs.ts` — NEW module.
- `packages/core/src/index.ts` — barrel export.
- `packages/core/package.json` — `./slice-runs` subpath export.

**Web, shared**
- `packages/web/components/HistoryPanel.tsx` — NEW generic panel.

**Web, sorter**
- `packages/web/app/api/sorter/jobs/route.ts` — add GET list.
- `packages/web/app/api/sorter/jobs/[id]/route.ts` — add DELETE.
- `packages/web/app/sorter/PastScans.tsx` — NEW.
- `packages/web/app/sorter/page.tsx` — header wrap + panel.

**Web, studio**
- `packages/web/lib/headshot-dto.ts` — add createdAt/renderer/source/downloadUrl.
- `packages/web/app/api/studio/headshots/[id]/route.ts` — NEW DELETE.
- `packages/web/app/studio/PastHeadshots.tsx` — NEW.
- `packages/web/app/studio/page.tsx` — header wrap + panel.

**Web, slice**
- `packages/web/app/api/slice/convert/route.ts` — record run on convert.
- the slice export route — mark run sliced.
- `packages/web/app/api/slice/runs/route.ts` — NEW GET list.
- `packages/web/app/api/slice/runs/[runId]/route.ts` — NEW DELETE.
- `packages/web/app/slice/PastSlices.tsx` — NEW.
- `packages/web/app/slice/page.tsx` — header wrap + panel.

## Testing

- Unit (core): `slice-runs.test.ts` — create then list returns the row
  (createdAt desc), `markSliceRunSliced` flips status, `deleteSliceRun` removes
  it, list empty by default. Migration: `slice_runs` table exists after
  `runMigrations`, idempotent.
- Unit (web, light): a `GET /api/sorter/jobs` returns rows ordered desc (can be
  covered by a route-level test mirroring existing sorter-route tests if the
  harness supports it; otherwise rely on manual + the core query being trivial).
- Manual (`npm run dev`): each tool shows its "See past ..." button; the panel
  lists prior runs with correct badge/date; Delete confirms and removes the row
  (and its files); studio Download opens the render; slice rows older than 6h
  read "Expired" with no download; empty states show.

## Dev + house rules

- After core changes rebuild core (`npm -w @event-editor/core run build`) and
  re-migrate the dev DBs. Note there are TWO dev DBs: root `data/app.db` and
  `packages/web/data/app.db` (the dev server runs from `packages/web`, so it
  opens the latter). Migrate the web one with
  `EE_DB_PATH="$PWD/packages/web/data/app.db" npm -w @event-editor/core run migrate`.
- Reviewer caveat: `packages/web` has 5 PRE-EXISTING tsc errors in
  `test/docs.test.ts` + `test/canva-oauth.test.ts`; "clean" = no new errors from
  touched files.
- Any new core module web imports needs BOTH a barrel export AND a
  `package.json` subpath entry.
- Anti-vibecode: reuse `card` / `btn` / `eyebrow` / `StatusBadge`; the panel is a
  single card (no nested cards); status badges carry the only semantic colour;
  sentence-case, no em dashes; Delete is the two-step inline confirm, no native
  `confirm()` dialog.
