# Slice feature: Drive picker + topic axis + empty-dir leak fix

Date: 2026-07-03
Status: Approved design, pending implementation plan
Scope: `packages/web` slide-slicer (`/slice`) + one `packages/core` prompt helper

## Problem

The slide slicer has three loose ends:

1. **Drive input is a raw text field.** `SliceClient.tsx` asks the user to paste a
   Google Drive *file id* by hand. There is no way to browse Drive; you have to go
   find the id yourself.
2. **Only two slicing axes.** Slices are cut either by manual page ranges or by
   speaker segmentation (Claude). There is no way to cut by topic/section.
3. **Empty temp dirs leak.** `convert/route.ts` creates the per-run temp directory
   (`data/slice/<runId>/`) *before* it validates the request, so any early 400
   orphans an empty directory. It self-heals via the 6h sweep, but that is a
   band-aid over an ordering bug.

## Decisions

- **Native Google Picker** (the real `google.picker` widget), not an in-app
  list. Matches the "real picker" intent: search, folders, thumbnails, My/Shared
  drives for free.
- **Server-vended access token**, not a client-side GIS consent popup. The app is
  already connected to Google server-side; a second browser consent would be
  redundant. A small route mints a short-lived access token from the stored OAuth
  creds. Trade-off accepted: a ~1h token briefly lives in the browser during the
  picker session. This is a single-user tool operating on the user's own Drive, so
  the exposure is the user's own token in the user's own browser.
- **All three items in one spec/plan.** The leak fix is ~3 lines and rides along as
  a trivial task.

## Design

### 1. Native Google Picker (replaces the file-id field)

**Config (new, one-time, user-supplied):**
- `GOOGLE_PICKER_API_KEY` — a Google Cloud *browser* API key (Picker API enabled).
- `GOOGLE_PICKER_APP_ID` — the Cloud project number.

Both are read server-side and returned in the `GET /api/drive/token` response
(`apiKey`, `appId` below), so they are not hardcoded in the bundle. Setup steps
documented in the plan.

**New route `GET /api/drive/token`:**
- Returns `{ access_token, expires_at, apiKey, appId }` minted from the stored OAuth
  credentials, refreshing if the token is stale.
- Returns 400 `{ error: "Google is not connected. Re-auth on settings." }` when
  Google is not connected (mirrors the existing convert-route guard).
- Reuses `authedDriveClient(getDb())` plumbing to reach the stored creds. The
  access token is not persisted client-side beyond the picker session.

**`SliceClient.tsx` changes:**
- The bare `driveFileId` `<input>` is replaced as the *primary* control by a
  **"Choose from Drive"** button.
- Click → lazy-load Picker JS (`gapi.load('picker')`), `GET /api/drive/token`, open
  a `PickerBuilder` scoped to `.pptx`
  (mime `application/vnd.openxmlformats-officedocument.presentationml.presentation`)
  plus legacy `.ppt`.
- On pick: store `driveFileId` and show the filename as a chip.
- The raw id `<input>` survives as a **collapsed "paste an id instead" fallback** so
  no existing behavior regresses.

**`convert/route.ts`:** unchanged in contract — still receives `driveFileId` in the
body. The picker only changes how that field gets filled.

### 2. Topic/section slicing axis

**Client:**
- `mode` state widens from `"manual" | "speaker"` to
  `"manual" | "speaker" | "topic"`.
- A third **"By topic"** button joins the segmented control.
- `segment()` sends the active axis to the segment route.

**Core (`packages/core/src/pptx.ts`):**
- New `buildTopicSegmentPrompt(slides)` — same contiguous / non-overlapping /
  1-based-index rules as `buildSpeakerSegmentPrompt`, but groups consecutive slides
  by subject and labels each with a short section title.

**Server (`packages/web/lib/anthropic.ts` + `/api/slice/segment`):**
- New `segmentByTopic(client, slides)`, a sibling of `segmentSpeakers`, reusing
  `SEGMENT_SCHEMA`. The `speaker` field carries the topic label — no schema churn.
- `/api/slice/segment` takes a `by: "speaker" | "topic"` param and dispatches to the
  right function. The speaker path is untouched; `by` defaults to `"speaker"` for
  backward compatibility.

Response shape is identical (`{ groups: [{ speaker, startSlide, endSlide }] }`), so
rows populate the same way and watermark / download / Drive-save flow unchanged.

### 3. Empty-dir leak fix

In `convert/route.ts`, move `mkdir(dir)` to **after** the `driveFileId` and
Drive-client validation (currently `mkdir` runs at ~line 27, before the ~line-36
checks). Early 400s then stop orphaning dirs. `sweepOldRuns(6h)` stays as the
backstop. ~3 lines; trivial task in the same plan.

## Testing

- **Topic segmentation:** unit test — fixture deck → groups are contiguous,
  non-overlapping, and cover all slides.
- **Token route:** connected → returns a token; not-connected → 400.
- **Leak fix:** test asserts no `data/slice/<runId>` dir exists after a 400 response.
- **Picker UI:** manual browser verification (the widget can't be unit-tested
  meaningfully).

## Out of scope (YAGNI)

- Folder-nav / thumbnails beyond what the native picker gives for free.
- Multi-file picking.
- Down-scoping the vended access token.
