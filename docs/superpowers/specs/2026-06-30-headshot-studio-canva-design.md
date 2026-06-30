# Headshot Studio — Canva Renderer (Plan 4b)

Date: 2026-06-30
Status: Design — approved, pending spec review
Supersedes/extends: `2026-06-29-headshot-studio-design.md` (Plan 4a, local renderer)

## Goal

Add a second renderer to Headshot Studio that produces headshots by autofilling a
Canva **brand template** with a chosen photo + name/title and exporting a PNG —
instead of (or alongside) the local `sharp` renderer shipped in 4a.

Single render only. Sheet-driven batch is **Plan 4c** (see "Forward look: 4c" below);
this spec deliberately shapes its interfaces so 4c is a thin loop on top, but builds
none of it.

## Prerequisites (out-of-band, documented not coded)

The user must, in Canva, before the tool can run the Canva path:

1. Be on a Canva **Teams or Enterprise** plan. The Connect API returns `403` on the
   autofill and export endpoints for free/Pro accounts. (Confirmed in scope: the
   target account is Teams/Enterprise.)
2. Create a **Connect integration** in the Canva developer portal with:
   - Redirect URL `http://127.0.0.1:3000/api/canva/callback` (Canva rejects `localhost`).
   - Scopes: `brandtemplate:meta:read`, `brandtemplate:content:read`, `asset:write`,
     `design:content:write`, `design:meta:read`, `design:content:read`.
3. Build a **brand template** containing data fields named exactly:
   - `photo` — an image field
   - `name` — a text field
   - `title` — a text field
4. Put `CANVA_CLIENT_ID` and `CANVA_CLIENT_SECRET` in the repo-root `.env`
   (no `EE_` prefix — matches the Google/Groq third-party-credential convention).

A `docs/setup/canva.md` walkthrough captures all of the above.

## Non-goals (4b)

- No sheet integration, no batch (that is 4c).
- No Canva asset-library cleanup — uploaded photos accumulate in the user's Canva
  assets. Out of scope (YAGNI); revisit only if it becomes a problem.
- No design dedup — each render creates a fresh Canva design. Fine for a single-user tool.
- No local framing on the Canva path — the brand template owns all styling/cropping.

## User flow

`/studio` gains a **Local | Canva** renderer toggle. Everything before the styling
step is shared:

```
browse Drive folder → pick photo thumbnail → enter name + title → [renderer toggle]
   ├─ Local  → pick a frame   → sharp render        → PNG   (existing 4a)
   └─ Canva  → pick a template → upload+autofill+export → PNG (this spec)
```

On the Canva path we upload the **raw full-res Drive photo** and let the template's
image field place/crop it. The 4a frame picker is local-only.

If Canva is not connected, the Canva branch shows a connect gate linking `/settings`.

## Architecture

### OAuth — Canva Connect (PKCE)

`packages/web/lib/canva/oauth.ts`:

- `buildAuthUrl(state)` — generate a PKCE `code_verifier` + S256 `code_challenge`;
  return the authorize URL. The verifier is stashed in a short-lived **httpOnly cookie**
  keyed by `state` (single-user local tool — a cookie is sufficient; no DB staging table).
- `exchangeCode(code, verifier)` — token exchange.
- `refresh(refreshToken)` — refresh-token grant.

Redirect: `http://127.0.0.1:3000/api/canva/callback`.

Routes:
- `GET /api/canva/auth` — set state cookie, redirect to Canva authorize.
- `GET /api/canva/callback` — validate state, read verifier cookie, exchange, persist.

Token persisted via the **existing** token store (`@event-editor/core/tokens`) under
`oauth_tokens(provider="canva")`; upsert preserves the refresh token (existing behaviour).

`/settings` gains a Canva connect card mirroring the Google one (connected/disconnected
state, connect button, scope note).

### Canva API wrapper

`packages/web/lib/canva/client.ts` — thin typed wrapper over Connect. Every call is
bearer-authed and wrapped in the transcriber's `withBackoff` (429/5xx, honors
`Retry-After`). Token is fetched from the store and refreshed on `401`.

- `listBrandTemplates()` → `{ id, title }[]` — feeds the dropdown.
- `getBrandTemplateDataset(id)` → field definitions — used to validate the naming
  convention and to surface a precise error if `photo`/`name`/`title` are missing.
- `uploadAsset(bytes, name)` → asset upload is an **async job**: create → poll → `assetId`.
- `createAutofillJob(templateId, data)` → `jobId`.
- `pollAutofill(jobId)` → poll until success → `designId`.
- `createExportJob(designId, "png")` → `jobId`.
- `pollExport(jobId)` → poll until success → `exportUrl`.

Three async poll loops (asset upload, autofill, export) — all share one bounded-poll
helper with backoff.

### Field mapping (naming convention)

At render time, fetch the chosen template's dataset and bind by **field name**:
`photo` (image) ← uploaded asset, `name`/`title` (text) ← form inputs. A pure resolver
`resolveTemplateFields(dataset) → { ok, data } | { error }` keeps this testable. Missing
named fields produce an actionable error ("add fields named photo/name/title to this
template"), not a stack trace. Chosen template id stored on the row in `canva_template_id`.

### Pipeline & status

Mirror 4a's dependency-injection style. Add to `packages/core/src/headshot.ts`:

```
runHeadshotCanva({ headshotId, photo, name, title, templateId }, deps)
```

where `photo` is a resolved reference (Drive file id) and `deps` are injected by web:
`{ downloadDrivePhoto, uploadAsset, autofill, pollAutofill, export, pollExport,
   writeOutput, updateStatus, resolveFields }`. Core owns the orchestration + status
transitions; web supplies concrete Canva/Drive/filesystem implementations
(`packages/web/lib/studio.ts`, extended). Taking a **fully-resolved** `{photo,name,title,
templateId}` is deliberate — 4c calls this exact function in a loop per sheet row.

Status walks the existing union (`headshots.status`):

```
autofilling   (download photo → upload asset → create+poll autofill)
   → exporting (create+poll export → download PNG)
   → done
   (any failure → error, with message)
```

**Output unified with local**: download the exported PNG bytes to
`data/headshots/<id>.png` (dir overridable via `EE_HEADSHOT_DIR`), set `output_path`,
and also store `export_url`. The existing `/api/studio/image/[id]` (path-contained)
serves both renderers, so preview/download is identical regardless of renderer.

Clears a known Plan 5 follow-up: extend `headshotStatusView` in
`packages/web/lib/status.ts` to map `autofilling`/`exporting` (today they fall through
to idle).

### Routes

- `GET /api/canva/auth`, `GET /api/canva/callback` — OAuth (above).
- `GET /api/studio/templates` — list brand templates for the dropdown (Canva-connected
  gate; returns a connect-needed signal otherwise).
- `POST /api/studio/headshots` — **extended** to accept `renderer` (`local|canva`) plus
  `templateId` (canva) or `frameId` (local); the runner branches on `renderer`.
- Reuse existing `GET /api/studio/headshots/[id]`, `GET /api/studio/image/[id]`.

### UI (`/studio` + `StudioClient`)

- Renderer toggle Local | Canva (anti-vibecode: segmented, neutral, single accent).
- Local branch: existing frame picker (unchanged).
- Canva branch: brand-template dropdown (loaded from `/api/studio/templates`); connect
  gate when not connected.
- Shared: Drive folder browse + photo pick, name, title.
- Submit → `POST /api/studio/headshots` with `renderer` + template/frame.
- Poll `[id]` → `StatusBadge` now showing autofilling/exporting/done.
- Recovery matches Plan 5: retry-in-place (re-run on the same row, **mint a new `hsId`**
  so the poll effect re-fires — studio's established pattern) + start-over; disabled
  reasons (no template selected, Canva not connected).

## Error handling

- `403` on autofill/export → explicit "this needs a Canva Teams/Enterprise plan" message.
- Expired token → silent refresh; refresh failure → re-connect prompt at `/settings`.
- Missing `photo`/`name`/`title` fields in the chosen template → actionable error.
- 429/5xx → bounded backoff honoring `Retry-After` (shared with the transcriber).

## Data / schema

**No migration.** The `headshots` table already carries `renderer`, `template_id`/
`canva_template_id`, `autofill_job_id`, `design_id`, `export_url`, `output_path`,
`source_drive_file_id`, and the `rendering|autofilling|exporting|done|error` status
union (added in 4a's generalized rebuild).

## Testing

All tests mock `fetch` — no live Canva calls.

- **core**: `runHeadshotCanva` with mocked deps — happy path (autofilling→exporting→done),
  403 path, missing-field path, status-transition assertions.
- **core**: `headshotStatusView` now covers `autofilling`/`exporting`.
- **web**: Canva client — job create/poll, backoff + `Retry-After`, 401→refresh→retry.
- **web**: PKCE helpers — verifier/challenge generation, S256 correctness.
- **web**: `resolveTemplateFields` — present/missing/wrong-type fields.

## Environment

- `CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET` — root `.env`.
- (Optional) `EE_CANVA_EXPORT_FORMAT` default `png`.
- Redirect is fixed at `http://127.0.0.1:3000/api/canva/callback`.

## Forward look: Plan 4c (sheet-driven batch) — NOT built here

Captured so 4b doesn't paint it into a corner. 4c lets the user pull people from a
master Google Sheet and churn out headshots for groups:

- **Sheets read** — add Google `spreadsheets.readonly` scope (re-consent, like the
  transcriber's `drive.file` widening). Connect a sheet, pick a tab, read rows.
- **Column mapping** — map sheet columns to `name`, `title`, and optionally `photo`.
- **Row → photo matching** — prefer an explicit **photo column** (Drive link / file id /
  filename) when present; otherwise fall back to **filename-matches-name** against the
  chosen Drive folder (fuzzy match). Resolver returns matched/ambiguous/unmatched per row.
- **Row picker** — checkbox list of rows with match status; user selects which to render.
- **Batch orchestration** — loop `runHeadshotCanva` per selected row (the reason 4b's
  signature takes a fully-resolved `{photo,name,title,templateId}`). Likely adds a
  `batch_id` column to group + a batch status/progress view. Per-row failures don't
  fail the batch (mirrors the sorter's per-photo error handling).

4c gets its own spec → plan → implementation cycle.
