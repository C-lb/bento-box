# Headshot Studio — Sheet-Driven Batch (Plan 4c)

Date: 2026-06-30
Status: Design — approved, pending spec review
Extends: `2026-06-29-headshot-studio-design.md` (4a local), `2026-06-30-headshot-studio-canva-design.md` (4b Canva)

## Goal

Render headshots for a whole group in one pass: pull people from a master Google
Sheet, match each row to a Drive photo, pick one renderer + one style, and churn
out a batch of PNGs with a reviewable results grid and a "download all" zip.

The single-render pipelines from 4a (`runHeadshotRender`) and 4b (`runHeadshotCanva`)
are the per-row engine — 4c is the sheet ingestion, photo matching, batch
orchestration, and results UI layered on top. It builds no new rendering logic.

## Prerequisites (out-of-band)

- Google account re-consent: 4c **widens** the Google OAuth scope to add
  `https://www.googleapis.com/auth/spreadsheets.readonly` (reading sheet values).
  Same re-consent flow as the transcriber's `drive.file` widening; `/settings`
  shows a stale-scope prompt until the user re-auths.
- A master Google Sheet whose first row is a header, with columns for at least
  name and title, and ideally a photo column (Drive link / file id / filename).
- Drive photos in a folder the user can browse (used for filename matching and to
  resolve photo-column filenames).
- For the Canva renderer: everything from 4b (Teams/Enterprise, a brand template
  with `photo`/`name`/`title` fields, Canva connected).

## Non-goals (4c)

- No writing results back to a Drive folder (the grid + zip is the delivery path).
- No persistent `batches` table — rows are grouped by a `batch_id` column on
  `headshots`; reloading an old batch by id works, but there is no batch-history list.
- No resume-across-restart: a server restart mid-batch leaves in-flight rows in
  their last persisted status; the user re-runs unfinished rows via per-row retry.
- No new rendering/styling logic — frames (4a) and templates (4b) are reused as-is.
- No mixed renderers within one batch: a batch is entirely Local or entirely Canva,
  one style applied to all rows.

## User flow

New page `/studio/batch` (single-render `/studio` unchanged):

```
connect gates (Google; + Canva if Canva renderer)
  → paste Sheet URL/id → pick tab
  → read rows; auto-detect name/title/photo columns; show mapping w/ override dropdowns
  → pick renderer (Local | Canva) + one style (a frame, or a brand template)
  → pick the Drive photo folder
  → MATCH: row table shows name, title, photo-match badge (matched/ambiguous/unmatched)
  → select rows (checkboxes) → "Generate N headshots"
  → RESULTS grid: per-row StatusBadge + thumbnail as each finishes; per-row retry;
    "Download all" → zip of finished PNGs
```

## Architecture

### Sheets read — `packages/web/lib/google/sheets.ts`

- Widen scope: add `SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly"`
  to the Google auth scope list in `lib/google/oauth.ts`; `buildAuthUrl` requests it.
- `authedSheetsClient(db)` mirrors `authedDriveClient` — builds a `sheets_v4.Sheets`
  from the stored Google token (token refresh handled by the shared OAuth2 client).
- `extractSpreadsheetId(input: string): string` — accepts a full
  `https://docs.google.com/spreadsheets/d/<id>/...` URL or a bare id; returns the id.
- `listTabs(sheets, spreadsheetId): Promise<string[]>` — sheet/tab titles.
- `readValues(sheets, spreadsheetId, tab): Promise<{ header: string[]; rows: string[][] }>`
  — first row is `header`, the rest are `rows`.
- `/settings`: a Google card already exists (from 4b era). Update its stale-scope
  check to also require `SHEETS_SCOPE`, prompting re-auth when missing.

### Column auto-detect — `packages/core/src/columns.ts` (pure)

- `detectColumns(header: string[]): { name: number | null; title: number | null; photo: number | null }`
  — case-insensitive header match with synonyms: name ← {name, full name},
  title ← {title, role, position, job title}, photo ← {photo, image, headshot, picture}.
  Returns the column index per field, or null if none matched.
- The UI seeds its mapping dropdowns from this and lets the user override; the
  override (chosen indices) is what downstream code consumes. `detectColumns` is
  advisory only.

### Photo matching — `packages/core/src/match.ts` (pure)

- `normalizeName(s: string): string` — lowercase, strip a trailing file extension,
  replace non-alphanumeric runs with a single space, collapse + trim. Used on both
  the sheet value/name and the Drive filename.
- `DRIVE_ID_RE` / `extractDriveId(cell: string): string | null` — pulls a file id
  from a Drive URL (`/file/d/<id>`, `?id=<id>`) or returns the cell if it is itself
  an id-shaped token (`[-\w]{25,}`); else null.
- `matchRow(args): RowMatch` where
  `args = { name: string; photoCell?: string; folderFiles: { id: string; name: string }[] }`
  and `RowMatch = { status: "matched" | "ambiguous" | "unmatched"; driveFileId?: string; candidates?: string[] }`.
  Logic:
  1. If `photoCell` is present and non-empty:
     - `extractDriveId(photoCell)` non-null → `{ matched, driveFileId }`.
     - else treat `photoCell` as a filename → match against `folderFiles` by
       `normalizeName`.
  2. Else match `normalizeName(name)` against `folderFiles` filenames.
  - Exactly one normalized match → `matched`; more than one → `ambiguous` (with
    `candidates` = the file ids); zero → `unmatched`.
- The web layer supplies `folderFiles` from the existing `DriveClient.listImages`.

### Batch schema + migration — the landmine

- Add a nullable `batchId` (`batch_id TEXT`) column to the `headshots` Drizzle schema.
- **Migration:** the project's `runMigrations` is idempotent `CREATE TABLE IF NOT
  EXISTS` DDL, which **silently no-ops on an existing table when a column is added**
  (documented project risk). Adding `batch_id` therefore requires a guarded
  `ALTER TABLE headshots ADD COLUMN batch_id TEXT` — gated on the column's absence
  via `PRAGMA table_info(headshots)`, run after the CREATE block, idempotent and
  lossless on the real on-disk db. The `test/drift.test.ts` schema-drift guard is
  updated to include `batch_id`.
- Re-migrate the dev db with the **ROOT** `npm run migrate` (the `-w core` form
  targets the wrong db file — documented gotcha).

### Batch creation + orchestration

- Core `createBatchHeadshots(db, args): number[]` where
  `args = { batchId: string; renderer: "local" | "canva"; styleId: string;
  rows: { driveFileId: string; nameText: string; titleText: string }[] }`.
  For each row: `renderer === "canva"` → `createCanvaHeadshot({ driveFileId,
  canvaTemplateId: styleId, nameText, titleText })`; else `createHeadshot({
  driveFileId, frameId: styleId, nameText, titleText })`. Each created row is then
  stamped with `batchId` (a `touch`/update, or the create helpers gain an optional
  `batchId`). Returns the created ids in row order.
- Web `runBatch(db, drive, renderer, ids)`: kicks off the per-row engine
  (`startHeadshotCanva` or `startHeadshot`) with a **concurrency cap** (default 3,
  `EE_BATCH_CONCURRENCY`) so a large group does not exceed Canva rate limits. A
  simple promise pool; each row's `runHeadshot*` already catches and records its own
  error, so a single failure never sinks the batch.
- `batchId` is a server-generated random hex string (Node `crypto.randomBytes`),
  not derived from `Date.now()`.

### Results + zip

- `GET /api/studio/batch/[batchId]` → `{ headshots: HeadshotDto[] }` for all rows
  with that `batch_id` (the poll endpoint). The DTO already carries status +
  imageUrl; the client renders a grid with `StatusBadge` (existing
  `headshotStatusView` covers `rendering`/`autofilling`/`exporting`/`done`/`error`).
- `GET /api/studio/batch/[batchId]/zip` → streams a zip of the finished rows'
  on-disk PNGs (`data/headshots/<id>.png`), named by person where available. Adds
  the `archiver` dependency (Node has no native zip). Skips non-`done` rows.
- Per-row retry: the row keeps its id and `batch_id` (it cannot mint a new id like
  the single-render client does, since the id ties it to the batch), so a `POST
  /api/studio/batch/[batchId]/retry/[id]` re-runs that one row on its stored inputs
  via the same per-row engine, and the grid's poll picks up the status change.

### Routes

- `GET /api/studio/sheets/tabs?spreadsheetId=` — list tabs; 401 if Google not
  connected, stale-scope hint if `spreadsheets.readonly` missing.
- `GET /api/studio/sheets/values?spreadsheetId=&tab=` — `{ header, rows }`.
- `POST /api/studio/batch/match` — body `{ spreadsheetId, tab, mapping, folderId }`;
  reads values, lists folder images, runs `matchRow` per data row; returns
  `{ rows: [{ index, name, title, match }] }`. Drives the table; no DB writes.
- `POST /api/studio/batch` — body `{ renderer, styleId, rows: [{ driveFileId,
  nameText, titleText }] }` (the selected, resolved rows); validates the style
  (`getFrame` for local, non-empty templateId for canva), mints `batchId`,
  `createBatchHeadshots`, `runBatch`, returns `{ batchId, ids }`.
- `GET /api/studio/batch/[batchId]` and `.../zip` and `.../retry/[id]` as above.

### UI — `packages/web/app/studio/batch/page.tsx` + `StudioBatchClient.tsx`

Anti-vibecode house style (one accent, neutral rest, sentence-case eyebrows, no em
dashes, 13px desktop type). Stepped layout mirroring the single-render client's
idiom (eyebrow-labelled steps). The row table and results grid are the two new
surfaces. Connect gates link `/settings`. Reuses `StatusBadge`, `headshotStatusView`,
the Drive folder picker pattern, and the brand-template dropdown from 4b.

## Error handling

- Google not connected → 401 + connect gate. `spreadsheets.readonly` missing →
  explicit re-auth prompt (the values call will 403 otherwise).
- Canva not connected (canva renderer) → connect gate, reusing 4b's signal.
- A row with `unmatched`/`ambiguous` photo is shown in the table but not selectable
  for render until resolved (ambiguous: the user picks a candidate; unmatched:
  excluded). The commit POST only accepts rows with a resolved `driveFileId`.
- Per-row render failures land that row in `error` with its message (403
  Teams/Enterprise message included, from 4b); the batch continues; the row offers
  retry.
- Empty sheet / no data rows / no name column mapped → actionable validation message,
  no batch created.

## Data / schema summary

`headshots` gains nullable `batch_id TEXT` (guarded `ALTER`, drift test updated).
No other schema change. No `batches` table.

## Testing

All tests pure/mocked — no live Sheets, Drive, or Canva.

- **core `columns.ts`**: detect by exact header, by synonym, case-insensitive,
  missing field → null, override passthrough.
- **core `match.ts`**: Drive URL → id, bare id → id, filename exact match,
  normalize equivalence (case/extension/punctuation), ambiguous (2 files),
  unmatched (0 files), photo-column-absent name match.
- **core `createBatchHeadshots`**: inserts N rows, each tagged with the batch id,
  correct renderer + style + name/title per row; mixed list stays single-renderer
  per the batch's `renderer`.
- **core migration**: guarded `ALTER` adds `batch_id` to a pre-existing
  `headshots` table (idempotent; second run is a no-op; existing rows preserved).
- **web `sheets.ts`**: `extractSpreadsheetId` (URL + bare id), `readValues`
  header/rows split, with a mocked `sheets_v4` client.
- **web `runBatch`**: respects the concurrency cap; a thrown row does not stop the
  others (mocked per-row engine).

## Environment

- No new credentials (reuses Google + Canva). New tuning var:
  `EE_BATCH_CONCURRENCY` (default 3).
- Google scope widened to include `spreadsheets.readonly` (re-consent required).

## Scope note

This is the largest plan in the project: Sheets ingestion, column detection, photo
matching, a guarded migration, batch orchestration with concurrency, a results grid,
and a zip endpoint, across both renderers. It remains one coherent vertical feature
(sheet → group of headshots), so one spec — but the implementation plan will carry
a longer task list than 4a/4b, and the pure-core units (`columns`, `match`,
`createBatchHeadshots`, migration) should land and be tested before the web glue.
