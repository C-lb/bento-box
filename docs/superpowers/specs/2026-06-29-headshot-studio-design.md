# Headshot Studio — Plan 4a (local renderer) design

Date: 2026-06-29
Status: approved (design), pending implementation plan

## What it does

Headshot Studio turns a raw photo into a finished, branded headshot — the kind
used on a LinkedIn profile, a conference badge, or a "meet the team" page —
without anyone opening Photoshop or Canva by hand.

Flow for one headshot:

1. **Pick a photo** — browse a Google Drive folder (same picker the sorter uses),
   see the image thumbnails, click one. The app pulls the full-resolution file.
2. **Pick a frame** — a layout template defining where the photo sits and how the
   name/title are presented. Choose from built-in designs.
3. **Type name + title** — e.g. "Jane Okafor" / "Head of Partnerships".
4. **Render** — the app crops the photo to fit the frame, lays the text over it,
   outputs a downloadable PNG.

Use case: batch event/team headshots — a uniform, on-brand set of portraits
instead of a pile of mismatched selfies.

Plan 4a is the **local renderer**: fully offline, free, no Canva account. It
composites with `sharp` (already a project dependency) and draws the text itself.
Plan 4b (later) adds the Canva path for teams that want their official Canva brand
templates. This spec covers **4a only**; the schema is generalized so 4b reuses it.

## Decomposition

- **Plan 4a (this spec):** `/studio` shell + schema generalization + local
  sharp/SVG renderer. Ships value with zero Canva.
- **Plan 4b (future):** Canva Connect OAuth (PKCE), brand-template autofill,
  export (Teams/Enterprise-only). Separate spec.

## Section 1 — Schema generalization

The existing unused `headshots` table is Canva-shaped. Generalize it so both
renderers share it.

Changes:

- Add `renderer TEXT NOT NULL DEFAULT 'local'` — `local` | `canva`.
- Make `canva_template_id` **nullable** (local rows have no Canva template).
- Add `template_id TEXT` — the generic frame id (e.g. `clean-band`).
- Add `output_path TEXT` — disk path to the rendered local PNG.
- Status union becomes `rendering | autofilling | exporting | done | error`.
  Local rows start at `rendering`.

Migration must do **both**:

- Updated `CREATE TABLE IF NOT EXISTS headshots (...)` for fresh DBs.
- Pragma-checked `ALTER TABLE ADD COLUMN` for existing DBs. **Guard each add by
  reading `PRAGMA table_info(headshots)` first** — SQLite silently no-ops a
  duplicate `ADD COLUMN` in some paths and we have hit this hazard before; the
  guard makes the migration idempotent and observable.
- Update the drift test to cover the new columns.

Drizzle `schema/index.ts` `headshots` table updated to match.

## Section 2 — Drive source + full-res fetch

Reuse Plan 2's folder picker and `listImages` to show a folder's image
thumbnails. Gap: the sorter only ever downloaded **thumbnails** (~220px), too
low-res for a headshot. Studio needs the original.

Add one method to `DriveClient` (`packages/web/lib/google/drive.ts`):

```ts
downloadFile(fileId: string): Promise<Buffer>   // drive.files.get({ fileId, alt: "media" })
```

Pulls the full-resolution original bytes. The `drive.readonly` / `drive.file`
scope already held covers this — no new consent.

Studio reads Drive directly; it does **not** depend on a prior sorter scan and
does not touch the `photos` table.

## Section 3 — Render pipeline + API

Async + polled, same shape as the audio transcriber.

Routes (`packages/web/app/api/studio/...`):

- **`POST /api/studio/headshots`** — body `{ driveFileId, frameId, nameText,
  titleText }`. Inserts a `headshots` row (`renderer='local'`,
  `status='rendering'`), kicks off a fire-and-forget render, returns `{ id }`.
- **`GET /api/studio/headshots/[id]`** — returns the row (status, `output_path`,
  `error_message`). UI polls this.
- **`GET /api/studio/headshots`** — recent renders, for a small gallery.
- **`GET /api/studio/image/[id]`** — streams the PNG off disk (same pattern as
  `/api/thumb`), with a **path-containment guard** so the id can only resolve
  inside `data/headshots/`.

Render core lives in `packages/core` (testable, dependency-injected like
`ingest`): `(photoBuffer, frameSpec, nameText, titleText) -> PNG buffer`. The
route writes the buffer to `data/headshots/<id>.png`, sets `status='done'` +
`output_path`. Any throw → `status='error'` + `error_message`, wrapped in
try/catch like the transcriber upload route so failures never strand a row.

## Section 4 — Frames (local)

A frame is **data**, not code: canvas size, photo region (with crop shape), and
text-block styling. Output canvas is **1080×1080 square** for 4a (universal for
LinkedIn/badges; portrait can be added later). The photo is always **cover-fit
and center-cropped** into its region so the subject stays centered.

Three built-in frames, all anti-vibecode (one accent, neutral rest,
sentence-case, soft shadows):

1. **`clean-band`** — full-bleed square photo; a charcoal band across the bottom
   (~22%) holding name (prominent) + title (dimmed), left-aligned; a single thin
   accent hairline above the band.
2. **`circle`** — neutral off-white canvas; photo **circular-cropped**, centered
   in the upper portion; name + title centered below in clean type. Classic round
   avatar treatment.
3. **`minimal-corner`** — full-bleed photo; a small rounded neutral plate
   bottom-left with a soft shadow holding name (accent) + title.

### Technical risk — text rendering

Drawing name/title means compositing an SVG overlay through `sharp`, and SVG text
needs the font actually available to the renderer. Plan: **bundle a font file**
(DM Sans or Geist) and load it. If `sharp`'s SVG engine will not reliably pick up
the bundled font, the fallback is **rendering text to vector paths** so no system
font is required. The **first implementation task must spike this** to de-risk
before the rest of the pipeline is built.

## Section 5 — `/studio` UI

Single stepped page (anti-vibecode skill applies). The landing page's currently
dead `/studio` link becomes live.

1. **Folder + photo** — folder picker → thumbnail grid → select one.
2. **Frame** — the 3 local frames as preview cards; a greyed
   "Canva brand templates — coming soon" affordance reserved for 4b.
3. **Details** — name + title inputs.
4. **Render** — button → poll status → show the PNG with a Download button;
   recent renders in a small gallery below.

## Out of scope (4a)

- Canva Connect OAuth, brand templates, autofill, export (→ Plan 4b).
- Sorter-job handoff / ranked-photo picker (folder browse only for now).
- Portrait / non-square output sizes.
- Multi-photo batch in one action (one headshot per render; gallery accrues them).

## Testing

- Core render: unit tests with a stubbed `sharp` and a fixture buffer; assert
  frame spec → composite calls and output for each of the 3 frames; assert
  center-crop geometry and circular mask path.
- Migration: drift test covers new columns; idempotency test re-runs migrate on a
  pre-existing headshots table.
- Routes: POST creates a row and returns id; GET reflects status transitions;
  image route enforces path containment; render failure sets `status='error'`.
