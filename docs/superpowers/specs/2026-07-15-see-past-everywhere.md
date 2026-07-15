# "See past …" on every tool

**Date:** 2026-07-15 · **Status:** approved (Caleb: "for shrink PDFs, there should be a 'See past xx' feature as well. make sure all tools have this feature.")

## Current state (audited)

Already have history: sorter ("See past scans"), studio single ("See past headshots"),
transcribe ("See past transcriptions"), slice ("See past slices"), heic ("See past
conversions") — all server/DB-backed, four via the shared `components/HistoryPanel.tsx`
dropdown. Client-side: cutout ("See past cut-outs", IndexedDB blobs) and shorten ("See past
links", localStorage).

Missing: **pdf, resize, video, splice, convert** (server jobDir outputs, 6h sweep, no record),
**qr** (client-only, nothing persisted), **badge/certificate/place-card/ticket** (client blob
downloads, nothing persisted), **studio batch tab** (batches only visible via the single-tab
panel).

## Design

Three mechanisms, matched to where each tool's output lives. Copy pattern: button label is
always "See past <plural noun>", panel behavior identical to the existing tools.

### A. Server jobDir tools → one shared `tool_runs` table (pdf, resize, video, splice, convert)

New core table (mirrors `heicConversions`' role, but generic so we don't mint five tables):

```
tool_runs: id TEXT pk, tool TEXT (pdf|resize|video|splice|convert), label TEXT (source filename
or short description), mode TEXT nullable (pdf: merge|split|compress; splice: trim|join; convert:
url|file), outputs TEXT json [{id, filename}], created_at INTEGER
```

Core helpers in packages/core (style of existing run helpers): `createToolRun`,
`listToolRuns(db, tool)` newest-first, `deleteToolRun`, plus insert-time pruning to the newest
**50 rows per tool** (rows are metadata only; files still die at the 6h sweep).

Web plumbing:
- `app/api/runs/[tool]/route.ts` GET list (validated tool whitelist) and
  `app/api/runs/[tool]/[id]/route.ts` DELETE. Auth same as sibling API routes.
- Each tool's process route records a run **after success only** (best-effort try/catch like
  slice's history write — recording must never fail the conversion). Outputs reference the
  existing file-id GET routes (`/api/pdf/file/[id]`, `/api/resize/[id]`, `/api/video/[id]`,
  `/api/splice/[id]`, `/api/convert/[id]`). Resize: the batch exists only client-side (the API
  takes one file per request), so history is one row per file — accepted deviation from the
  original one-row-per-batch idea.
- Shared client component `components/PastRuns.tsx` wrapping `HistoryPanel` with per-tool props
  (label, noun, mode badge). Download links hit the file-id routes; a 404/expired file renders
  the row's actions as an "Expired" `StatusBadge` (same UX as slice/heic; probe lazily on click,
  do not prefetch — cheap approach: keep the link, and show the tool page's standard error toast
  when the fetch 404s, PLUS a static "links expire ~6h after conversion" line in the panel
  footer). Keep it simple: footer disclosure + normal links is acceptable v1; per-row expired
  probing is not required.
- Panels wired into: PdfClient ("See past PDFs"), ResizeClient ("See past resizes"),
  VideoClient ("See past compressions"), SpliceClient ("See past splices"), ConvertClient
  ("See past conversions").

### B. Client-only small outputs → localStorage (qr)

QR codes are regenerable from their input text — persist metadata, not pixels. New
`lib/qr-history.ts` cloning `lib/shorten-history.ts` (key `ee.qr.history`, v:1, MAX 20,
`{id, text, at}` + the options needed to regenerate). Panel "See past QR codes" in QrClient:
clicking a row re-fills the form and regenerates. No blobs stored.

### C. Client blob outputs → IndexedDB (badge, certificate, place-card, ticket)

These four share `components/MergeToolClient.tsx` (certificate has its own client but same
shape — implementer: put the history in the shared component / a shared hook so all four get it
in one place). Clone the cutout pattern into a generic `lib/blob-history.ts` (db `ee-merge`,
store per tool key, keyPath id): `{id, tool, filename, blob, at}`, **MAX_ITEMS 6 per tool** and
**skip items over 50 MB** (merge zips can be huge; a skipped save is silent — the download the
user just made still happened). Panel "See past badges" / "certificates" / "place cards" /
"tickets": filename + Save (object URL) + remove + clear all, list layout like shorten (no
thumbnails — outputs are PDFs/zips).

### D. Studio batch tab

"See past batches" HistoryPanel in the batch tab: GET groups existing `headshots` rows by
`batchId` (new `app/api/studio/batches/route.ts` or extend the existing headshots API with a
`?grouped=1` param — implementer's choice, whichever is smaller), row = batch date + count +
zip link (`/api/studio/batch/[batchId]/zip`), DELETE removes the batch's rows.

### Non-goals

- No retention change: files still sweep at 6h; history rows outlive files (A-group) with the
  footer disclosure.
- No server-side persistence for qr/merge tools (stays client-side).
- cutout/shorten/sorter/studio-single/transcribe/slice/heic panels unchanged.
- No packaged desktop release in this wave.

## Implementation plan (subagent tasks, reviewer gate each, atomic commits)

**Task 1 — core table + web API + recording (group A backend).** `tool_runs` schema +
migration (remember: ROOT `npm run migrate`), core helpers + prune-to-50 + tests; generic
GET/DELETE routes + tool whitelist + tests; record-on-success in the 5 process routes (pdf may
record in its nested process/[mode] route), tests at the route seam (mock convert internals,
assert row written on success and not on failure).

**Task 2 — group A panels.** `components/PastRuns.tsx` + wire the 5 clients with correct
labels; expiry footer line; tests for any pure helpers (label/mode formatting). Playwright or
route-level check that each page still renders.

**Task 3 — qr + merge tools + studio batch (groups B, C, D).** `lib/qr-history.ts` (+ tests,
clone shorten-history tests), QrClient panel with re-fill-and-regenerate; `lib/blob-history.ts`
(+ tests, clone cutout-history tests incl. size-skip + prune), panels for the four merge tools
via the shared component; studio batch panel + API + tests.

**Task 4 — whole-wave verification.** Full web+core suites, tsc no-new-errors, `next build`,
live smoke: run the dev/prod server, exercise pdf-compress → row appears in "See past PDFs" →
re-download works; spot-check one merge tool and qr history in a real browser (Playwright).
Update docs if any tool has a doc page. Push to main when green.

## Risks

- `tool_runs` growth: capped at 50/tool by the insert helper.
- IndexedDB quota (merge blobs): 6-item cap + 50MB skip + cutout's swallow-quota-errors
  behavior.
- Recording must not break conversions: best-effort wrap, tested.
- Migration ordering on packaged desktop: migration runs via the standard boot path
  (migrate-on-start already established); no special handling needed this wave.
