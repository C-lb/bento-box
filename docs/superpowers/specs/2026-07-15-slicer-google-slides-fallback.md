# Slicer: Google Slides fallback for LibreOffice

**Date:** 2026-07-15 · **Status:** approved (Caleb: "Set up Google Slides as the alternative to LibreOffice for slicer")

## Problem

The deck slicer hard-requires LibreOffice (`findSoffice()`); without it the tool page renders a
"LibreOffice is required" card and `/api/slice/convert` 400s. On desktop LibreOffice is link-only
(never bundled), so a user who hasn't installed it has a dead tool — even though most installs
already have Google OAuth connected (Drive picker / sorter), and Drive can do the same pptx→PDF
conversion.

## Design

Provider chain, mirroring `lib/shorten.ts` (is.gd→v.gd→TinyURL): **LibreOffice first, Google
Slides second.** LibreOffice stays preferred (local, no upload, no size cap).

### New module: `packages/web/lib/slides-convert.ts`

```ts
type SlidesConvertOutcome =
  | { ok: true; pdf: Buffer }
  | { ok: false; kind: "not-connected" | "too-large" | "rejected" | "unreachable"; error: string };

convertViaGoogleSlides(pptxPath: string, db: Db): Promise<SlidesConvertOutcome>
```

Mechanism (all via the existing `authedDriveClient(db)` googleapis client):
1. Size gate first: stat the pptx; > `SLIDES_IMPORT_MAX` (100 MB, Google's Slides import cap) →
   `{ok:false, kind:"too-large"}` without uploading.
2. `drive.files.create` with `requestBody: { name, mimeType: "application/vnd.google-apps.presentation" }`,
   `media: { mimeType: pptx mime, body: createReadStream(pptxPath) }` — the mimeType mismatch is
   what triggers Drive's import conversion. `supportsAllDrives: true`, `fields: "id"`.
3. Export to PDF. **Two-step because `files.export` hard-caps payloads at 10 MB:**
   a. try `drive.files.export({ fileId, mimeType: "application/pdf" })` (arraybuffer);
   b. on `exportSizeLimitExceeded` (403), fetch
      `https://docs.google.com/presentation/d/<id>/export/pdf` with the OAuth bearer token
      (obtain via `googleAccessToken(db)`), which serves large exports.
4. `finally`: best-effort `drive.files.delete({ fileId })` — the temp Slides doc must not
   accumulate in the user's Drive. Deletion failure is logged, never thrown.

Scopes: already sufficient — `drive.file` (granted since the Drive-save feature) covers
create + export + delete of app-created files. No consent re-prompt needed.

Pure, unit-testable helpers (mirror `sofficeConvertArgs` / `classifyCreatePhp` style):
- `classifySlidesError(err): kind` — maps googleapis errors (401/invalid_grant → "not-connected",
  403 quota/rate → "unreachable" (retryable-ish), 400 import failures → "rejected", network → "unreachable").
- `slidesCreateParams(name)` / decision helper `converterPlan(sofficePresent, googleConnected)`
  → ordered provider list, so the route logic is testable without spawning anything.

### Route change: `app/api/slice/convert/route.ts`

Replace the hard `findSoffice()` 400 gate with the chain:
1. If soffice present → `convertToPdf()`. On success, done (unchanged path).
2. If soffice absent OR `convertToPdf` threw → if Google connected, run
   `convertViaGoogleSlides(deckPath, db)`; on `ok`, write `pdf` to `masterPdfPath(runId)` and
   push a warning: `"Converted with Google Slides (LibreOffice unavailable) — layout fidelity may differ slightly."`
   If LibreOffice *failed* (rather than missing), include its error in a second warning so real
   soffice bugs stay visible.
3. Both unavailable/failed → 400 with aggregate copy:
   `"Slicing needs LibreOffice or a connected Google account. Install LibreOffice, or connect Google in Settings."`
   (If Google was attempted and failed, surface its classified message instead.)

Everything downstream (`readSlides`, `pdfPageCount` mismatch warning, export, history) is
untouched — it only consumes `masterPdfPath`.

### Page gate: `app/slice/page.tsx`

Render the tool when `findSoffice() !== null` **or** a Google token exists (`getToken(db,"google")`
non-null). The "LibreOffice is required" card becomes "LibreOffice or Google required" with both
remedies (brew install line + link to `/settings` Google connect). Keep it server-rendered as today.

### Deps surface: `packages/web/lib/deps.ts`

`libreoffice` dep entry: when `findSoffice()` is null but Google is connected, keep `ready:false`
but extend `hint` with "…or connect Google — the slicer falls back to Google Slides." (Health
consumers still see the honest binary state.)

## Non-goals

- No change to LibreOffice-first preference, upload caps, or the drive-input path (a Drive file
  still downloads first, then converts — no server-side copy-convert shortcut this round).
- No UI toggle to force a provider.
- Android/desktop packaging unchanged.

## Implementation plan (subagent tasks)

**Task 1 — `lib/slides-convert.ts` + unit tests.**
Module as specced. Tests (`test/slides-convert.test.ts`, vitest node env): size gate, classifier
table, create-params shape, export fallback selection on `exportSizeLimitExceeded`, temp-file
delete always attempted (mock drive client object; no network). Mirror `drive.test.ts` mocking style.

**Task 2 — route chain + page gate + deps hint + tests.**
`convert/route.ts` provider chain (keep `guardUpload` first, keep run-dir cleanup on failure);
`slice/page.tsx` OR-gate + card copy; `deps.ts` hint. Tests: `converterPlan` decision table +
route-level behavior where practical (existing route tests as reference). Update the two
error-message strings anywhere they're asserted.

**Task 3 — docs + verification.**
Update `docs/` tool notes if the slicer has one; run full web test suite + `next build`;
Playwright smoke: with `EE_SOFFICE_PATH=/nonexistent` and Google connected, a small real pptx
converts end-to-end via Slides (needs live Google token in the dev DB — if unavailable, mock at
the drive-client seam and note the live walk as owed).

Each task: implement → reviewer subagent gate → atomic commit. Push to main when green.

## Risks

- **Fidelity:** Google's pptx import substitutes missing fonts / shifts exotic layouts — same
  class of problem as LibreOffice; the warning string discloses it.
- **Privacy:** deck transits the user's Google account briefly; temp file deleted in `finally`.
  Disclosed in the conversion warning? No — keep to the card copy: "falls back to converting via
  your Google account."  (Add one sentence to the tool card.)
- **Large exports:** the docs.google.com export URL is not a formally documented API; if it ever
  breaks, only >10 MB-PDF decks lose the fallback (classified "unreachable", LibreOffice message
  still shown). Acceptable.
