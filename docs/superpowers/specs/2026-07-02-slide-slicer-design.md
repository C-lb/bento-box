# Slide Slicer — Design Spec

Date: 2026-07-02
Status: Approved, ready for planning

## Summary

Two deliverables in one branch:

1. **Slide Slicer** — a new tool that converts a PowerPoint deck to PDF, splits it
   into portions (by manual page ranges or by AI-detected speaker sections), and
   optionally stamps each output page with a diagonal `CONFIDENTIAL` watermark.
   Outputs are delivered as individual PDF downloads, a zip of all portions, and
   optionally saved to Google Drive.
2. **Transcription save nudge** — a small UX fix on the transcriber's event-details
   panel so the user is told to press Save when they have unsaved edits.

The Slide Slicer is the bulk of the work; the save nudge ships alongside it.

## Goals

- Turn a `.pptx` into faithful PDF pages, fully offline (confidential decks never
  leave the machine).
- Let the user carve the deck into named portions two ways: manual page ranges, or
  AI segmentation by speaker.
- Optionally watermark every output page `CONFIDENTIAL`.
- Deliver as per-portion downloads, a zip-all, and optional Google Drive save.
- Keep confidential content ephemeral: no slide content persisted to the app db.

## Non-goals

- No topic/section slicing axis (speaker segmentation only for the AI mode).
- No faithful pure-JS PPTX rendering; we depend on LibreOffice for conversion.
- No cloud conversion service (would send confidential decks to a third party).
- No persisted "past slices" history storing content (ephemeral by design; a
  metadata-only recent list is a possible later addition, out of scope here).

## Key decisions (approved)

| Decision | Choice |
| --- | --- |
| Render engine | **LibreOffice headless** (`soffice --convert-to pdf`), local, offline. Same shell-out pattern as the transcriber's ffmpeg. |
| Input source | **Both** — drag-drop `.pptx` upload and Google Drive folder picker. |
| Content slicing | **Speaker portions only** — Claude reads slide text + notes and proposes speaker groups. |
| Delivery | **Both** — individual PDF downloads + zip-all, and optional Save to Drive. |
| Watermark | Diagonal, semi-transparent grey. **Text editable, default `CONFIDENTIAL`.** |
| Persistence | **Ephemeral** — temp working dir, cleaned up after delivery; no slide content in the db. |
| New dependency | `pdf-lib` (pure-JS, MIT, no native build) for page extraction + watermark. |

## Where it lives

New tool tab **Slide Slicer** at route `/slice`, alongside Photo Sorter,
Transcriber, and Studio. Reuses the shared shell: `Nav`, `StatusBadge`,
anti-vibecode styling, and the existing status / retry-in-place / start-over
conventions.

## Pipeline

1. **Input** — drag-drop a `.pptx`, or pick one from a Google Drive folder (reuses
   existing Drive auth + picker pattern from the sorter/studio). The file is written
   to a per-run temp working dir.
2. **Convert** — shell out to
   `soffice --headless --convert-to pdf --outdir <tmp> deck.pptx` producing one
   master PDF. In parallel, `officeparser` extracts per-slide text + speaker notes
   for the AI step. Assume slide *n* maps to PDF page *n* (documented caveat:
   hidden slides can break the 1:1 mapping; if page count != slide count, fall back
   to page-index labels and warn).
3. **Choose slices** — one groups editor, two modes:
   - **Manual**: user defines groups, each `{ label, pageRanges }`
     (e.g. `Intro = 1-3`, `Q&A = 12-18`). Each group becomes one output PDF. Ranges
     are parsed, clamped to the page count, and overlaps/gaps flagged (non-blocking
     warnings).
   - **By speaker**: Claude reads slide text + notes and returns proposed groups
     `[{ speaker, slideRange }]`, which populate the same editor for review/edit
     before export.
4. **Confidential** — per-run toggle. When on, every page of every output PDF gets a
   diagonal, semi-transparent grey watermark using the editable text (default
   `CONFIDENTIAL`).
5. **Export** — for each group: extract its pages from the master PDF and apply the
   watermark (if enabled) with `pdf-lib`. One PDF per group, filename derived from
   the sanitized group label.
6. **Deliver** — download each PDF individually, download a zip of all portions
   (reuse `archiver`), and/or Save to Drive into a chosen folder.

## Modules

### core (pure, unit-tested)

- `core/src/pptx.ts` — extract per-slide text + speaker notes from a `.pptx`
  (wraps `officeparser`); expose slide count and slide→page mapping helper.
- `core/src/slice-plan.ts` — parse/normalize/validate page-range groups:
  - parse `"1-5,8"` → `[1,2,3,4,5,8]`
  - clamp to `[1, pageCount]`
  - detect overlaps and gaps across groups (returns warnings, does not throw)
  - sanitize group labels into safe filenames (dedupe collisions)

### web

- `web/lib/pptx-convert.ts` — LibreOffice detection + `soffice` shell-out to PDF.
- `web/lib/pdf-slice.ts` — `pdf-lib` page extraction from the master PDF and
  diagonal watermark stamping.
- `web/lib/anthropic` (existing) — speaker segmentation via structured output.
- Routes:
  - `POST /api/slice/convert` — accepts upload or Drive fileId → master PDF (temp)
    + per-slide text + page count.
  - `POST /api/slice/segment` — slide texts → proposed speaker groups.
  - `POST /api/slice/export` — groups + confidential flag/text → PDFs (+ zip).
  - `POST /api/slice/drive-save` — write output PDFs to a chosen Drive folder.
- UI: `app/slice/page.tsx`, `SliceClient.tsx`, a groups editor component, and a
  speaker-review view.
- LibreOffice presence is surfaced via `StatusBadge`. If missing, the tool is
  disabled with install instructions (same treatment as ffmpeg / API key checks).

## Confidentiality stance

Everything runs in a per-run temp dir and is cleaned up after delivery. No slide
content is written to the app db. Unlike the transcriber there is no history table
holding content. This keeps confidential decks from lingering on disk or in the db.

## Watermark spec

- Diagonal (approx. -45°), centered on each page, repeated/large enough to cover the
  page like the reference image.
- Semi-transparent grey (low opacity, light-grey fill) so underlying content stays
  readable.
- Text editable per run, default `CONFIDENTIAL`.
- Applied via `pdf-lib` after page extraction, before final write.

## Part 1 — transcription save nudge

On `web/app/transcribe/EventDetailsPanel.tsx`:

- Track a dirty state: the current form values differ from the last-saved values.
- When dirty, show an inline reminder near the Save button
  ("Unsaved changes — press Save details") and keep the existing Saved confirmation.
- Add a `beforeunload` guard that warns when navigating away with unsaved edits.
- After a successful save, reset the baseline so dirty clears.

## Error handling

- **LibreOffice missing** — detect up front, disable the tool, show install steps.
- **Conversion failure** — surface soffice stderr summary, allow retry in place.
- **Slide/page count mismatch** — warn, fall back to page-index labels for the
  speaker mode; manual mode still works on page numbers.
- **Invalid page ranges** — clamp + warn; block export only if a group resolves to
  zero pages.
- **AI segmentation failure** — fall back to manual mode; the user can still slice.
- **Drive save failure** — non-fatal; downloads still available; show error + retry.

## Testing (TDD, per house style)

- `core/src/slice-plan.ts` — range parsing, clamping, overlap/gap detection, label
  sanitization/dedupe.
- `core/src/pptx.ts` — slide text/notes extraction and page mapping (fixture pptx).
- `web/lib/pdf-slice.ts` — page extraction and watermark stamping (pdf-lib
  in-memory; assert page count + presence of watermark text object).
- Route tests with mocks for convert/segment/export/drive-save.
- Segmentation prompt-shape test (mocked Anthropic client).
- Part 1: dirty-state logic on the details panel.

## Open questions

None blocking. Deferred: metadata-only recent list; topic/section slicing axis.
