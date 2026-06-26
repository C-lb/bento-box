# event-editor — design

**Date:** 2026-06-26
**Status:** approved (design)

## Summary

A local single-user tool (modeled on `event-drafter`) with two loosely-coupled
tools under one app shell:

1. **Photo Sorter** — scans a Google Drive folder, ranks each photo for
   LinkedIn-headshot fitness (local heuristics filter → Claude vision rank), and
   presents a reviewed grid.
2. **Headshot Studio** — takes a chosen photo (handed off from the Sorter or
   uploaded directly), autofills a Canva brand template with it plus name/title
   text, and exports a finished headshot PNG.

The two tools share only the app shell and the SQLite database. The single
handoff between them is a "Send to Headshot Studio" action on a sorted photo.

Non-goals (YAGNI): multi-user/accounts, scheduling/cron, background daemon,
AI-generated (non-template) headshots, editing photos in-app, publishing to
LinkedIn.

## Architecture

Two-package npm-workspaces monorepo. No separate worker process — all work runs
on-demand from Next.js route handlers as async jobs tracked in SQLite and polled
by the UI.

```
event-editor/
  package.json            # workspaces: packages/*
  tsconfig.base.json
  .env / .env.example     # Google OAuth, Anthropic, Canva Connect creds
  data/app.db             # SQLite (gitignored)
  docs/
    superpowers/specs/    # this doc
    setup/                # google-oauth.md, canva.md
  packages/
    core/                 # @event-editor/core
    web/                  # @event-editor/web
```

### `@event-editor/core`

SQLite via `better-sqlite3` + Drizzle ORM. Owns schema, migrations, types,
settings, and the pure scoring functions. Mirrors `@event-drafter/core`.

**Tables:**

- `jobs` — one row per sorter run.
  - `id`, `drive_folder_id`, `drive_folder_name`
  - `status`: `scanning` | `heuristics` | `ranking` | `done` | `error`
  - `total`, `processed` (for progress), `error_message`
  - `created_at`, `updated_at`
- `photos` — one row per image found in a scan.
  - `id`, `job_id` (fk)
  - `drive_file_id`, `name`, `mime_type`, `thumbnail_path`
  - `width`, `height`, `sharpness`, `brightness`, `aspect_ratio`, `face_count`
  - `stage`: `pending` | `rejected` | `ranked` | `errored`
  - `reject_reason` (nullable), `error_message` (nullable)
  - `score` (0–100, nullable until ranked), `reasons` (json, nullable)
  - `rank` (nullable, computed after ranking)
- `headshots` — one row per Headshot Studio attempt.
  - `id`, `source` (`sorter` | `upload`)
  - `source_photo_id` (fk nullable), `source_upload_path` (nullable)
  - `canva_template_id`, `name_text`, `title_text`
  - `autofill_job_id` (Canva's async job id), `design_id`
  - `status`: `autofilling` | `exporting` | `done` | `error`
  - `export_url`, `error_message`
  - `created_at`, `updated_at`

**Pure functions (unit-tested):**

- `scoreHeuristics(meta) -> { rejected: boolean, reason?: string, metrics }`
  — given decoded-image metrics, apply thresholds (min resolution, min
  sharpness, aspect-ratio band, brightness band, exactly one face).
- `buildRankPrompt(photo) -> messages` — assembles the Claude vision request
  from the LinkedIn rubric.
- `computeRanks(photos) -> photos` — sort ranked photos by score, assign `rank`.

### `@event-editor/web`

Next.js 16 + React 19 + Tailwind on localhost:3000. UI plus route handlers that
perform the work. **Anti-vibecode** house style throughout (one accent over a
neutral grey/black/white system, DM Sans, raised-edge mostly-grey buttons, soft
diffuse shadows, generous spacing, sentence-case eyebrows, semantic colour only
to carry meaning, full input/button feedback states with toasts and spinners).

**Routes (UI):**

- `/` — landing / tool switcher (Photo Sorter, Headshot Studio).
- `/sorter` — pick folder, watch a running job, review the sorted grid.
- `/studio` — pick source photo, pick Canva template, fill text, export.
- `/settings` — connection status for Google / Anthropic / Canva, re-auth.

**Route handlers (API):**

- `POST /api/sorter/jobs` — body `{ driveFolderId }`. Creates a `jobs` row,
  kicks off ingest, returns `jobId`. Ingest → heuristics → ranking run as an
  async sequence that updates the row; the handler returns immediately.
- `GET /api/sorter/jobs/:id` — job status + progress + photos (for polling).
- `GET /api/drive/folders` — list candidate Drive folders.
- `GET /api/canva/templates` — list Canva brand templates.
- `GET /api/canva/templates/:id` — template dataset (fields).
- `POST /api/studio/headshots` — body `{ source, photoId|upload, templateId,
  nameText, titleText }`. Creates `headshots` row, starts Canva autofill,
  returns `headshotId`.
- `GET /api/studio/headshots/:id` — status + export url (for polling).

External clients live in `packages/web/lib/`: `google.ts` (Drive),
`anthropic.ts` (vision), `canva.ts` (Connect API). Each is a thin wrapper with a
single responsibility and is mockable in tests.

## Data flow

### Photo Sorter

1. **Pick source** — `/sorter` calls `GET /api/drive/folders`; user picks one.
2. **Start job** — `POST /api/sorter/jobs` creates the `jobs` row (`scanning`).
3. **Ingest** — handler lists image files in the folder (Drive API), downloads a
   thumbnail per file to `data/thumbs/`, writes a `photos` row each, updates
   `total`. Status → `heuristics`.
4. **Stage 1 — local heuristics** (free): decode each image, compute resolution,
   sharpness (Laplacian variance), aspect ratio, brightness, face count via a
   light local face-detect. `scoreHeuristics` rejects junk (`stage=rejected`
   with reason). Survivors stay `pending`. Status → `ranking`.
5. **Stage 2 — Claude vision rank**: for each survivor, send the image to Claude
   with the LinkedIn rubric (face clarity, eye contact, framing, lighting,
   background, attire, expression). Store `score` + `reasons`,
   `stage=ranked`. Increment `processed`.
6. **Finalize** — `computeRanks` assigns `rank`. Status → `done`.
7. **Review** — `/sorter` renders a grid sorted by score: thumbnail, score,
   reasons, reject/error badges. Each ranked tile has **Send to Headshot
   Studio** (navigates to `/studio` pre-seeded with that `photoId`).

### Headshot Studio

1. **Source photo** — a `photoId` handed off from the Sorter, or a direct
   upload saved to `data/uploads/`.
2. **Pick template** — `GET /api/canva/templates` → user picks a branded
   headshot frame; `GET /api/canva/templates/:id` returns its fields.
3. **Fill** — user enters name/title; the photo maps to the template's image
   field.
4. **Autofill** — `POST /api/studio/headshots` creates the design from the brand
   template (Canva autofill, async). Store `autofill_job_id`,
   status `autofilling`.
5. **Export** — once autofill completes, request a PNG export; store
   `export_url`, status `done`.
6. **Result** — `/studio` shows a preview, a download button, and an
   "open in Canva" link.

## Error handling

- **Auth/token expiry** (Google or Canva): surface a re-auth prompt on
  `/settings` and inline where the call failed; mark the job/headshot `error`
  with a clear message rather than crashing.
- **Per-photo failure** (corrupt image, vision API error): mark that `photos`
  row `stage=errored` with the reason and continue the rest of the job.
- **Canva async**: autofill and export are async on Canva's side; poll their job
  ids and reflect `autofilling` / `exporting` in the UI.
- **Rate limits**: process photos sequentially with retry + exponential backoff;
  no parallel flooding of the vision or Canva APIs.
- **Empty/odd folders**: a folder with no images finishes immediately as `done`
  with `total=0`; the UI shows an empty state.

## Testing

Vitest in both packages (matches event-drafter).

- **core**: migration applies cleanly; `scoreHeuristics` threshold behavior with
  fixture metrics (blurry, low-res, no-face, multi-face, good); `computeRanks`
  ordering; `buildRankPrompt` shape.
- **web**: route-handler logic with mocked `google.ts` / `anthropic.ts` /
  `canva.ts` — job lifecycle transitions, per-photo error isolation, headshot
  autofill→export status flow. No live API calls in tests.

## One-time setup

1. `docs/setup/google-oauth.md` — GCP OAuth client, Drive read scope (reuse the
   event-drafter pattern).
2. `docs/setup/canva.md` — Canva Connect app, brand-template + autofill + export
   scopes, OAuth redirect.
3. `.env` keys: `GOOGLE_CLIENT_ID/SECRET`, `ANTHROPIC_API_KEY`,
   `CANVA_CLIENT_ID/SECRET`, `EE_DB_PATH`.

## Build order (for the implementation plan)

1. **Foundation** — monorepo scaffold, core schema + migration, web shell with
   anti-vibecode layout, settings/connection page.
2. **Drive ingest** — OAuth, folder list, scan job, thumbnails, `photos` rows.
3. **Sorter ranking** — heuristics stage, Claude vision stage, review grid.
4. **Headshot Studio** — Canva templates, autofill, export, result view.
5. **Polish** — error states, empty states, toasts/spinners, handoff seam.
