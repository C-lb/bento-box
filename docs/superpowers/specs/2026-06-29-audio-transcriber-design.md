# Audio Transcriber — design

Status: approved 2026-06-29
Adds a third tool to event-editor alongside Photo Sorter and Headshot Studio.

## Goal

Upload a large audio file, get back a Google Doc containing a Claude-written
summary followed by the full timestamped transcript. Single-user, local, runs
on-demand from Next.js route handlers (no worker), mirroring the Sorter.

## Non-goals (YAGNI)

- Speaker diarization / speaker labels.
- In-app transcript editing or playback.
- Multi-file batch transcription in one job (one file per job).
- Translation. Live streaming transcription.
- Any transcription provider other than Groq.

## Decisions

- **Transcription engine: Groq** (`whisper-large-v3-turbo`, OpenAI-compatible
  `audio/transcriptions` endpoint). Chosen for a genuinely free ongoing tier.
  Trade-off accepted: Groq's free tier caps request size (~25MB), so large
  files are transcoded + chunked locally rather than sent whole.
- **Large-file handling: local ffmpeg chunking** via the bundled `ffmpeg-static`
  binary (no system ffmpeg dependency). Transcode to 16kHz mono, split into
  ~10-minute segments; each lands well under the size cap.
- **Transcript style: timestamped.** Groq requested with `verbose_json` so
  per-segment start times are available. Each chunk's segment times are
  offset-adjusted by the chunk's start, then merged into one ordered list.
- **Summary: Claude** via the existing `anthropic.ts` pattern. Opus 4.8's large
  context handles long transcripts in a single call.
- **Output: Google Doc via Drive conversion.** `files.create` uploads HTML with
  `mimeType: application/vnd.google-apps.document`; Drive converts HTML → a
  formatted Doc. Simpler than the Docs API `batchUpdate` path.
- **Google scope widens** from `drive.readonly` to `drive.readonly drive.file`.
  `drive.file` only grants access to files the app itself creates, so it cannot
  read or modify pre-existing Drive content. Requires a one-time re-consent.

## Architecture

Reuses the established two-package monorepo and the async-job-polled-by-UI
pattern. No new process. Env prefix `EE_` for tunables; provider creds keep
their conventional names.

### `@event-editor/core` (pure + orchestration)

**New table `transcriptions`:**

- `id` (pk, autoincrement)
- `original_filename` (text, not null)
- `source_upload_path` (text, not null)
- `duration_sec` (real, nullable)
- `status` (text, not null, default `uploading`):
  `uploading | transcribing | summarizing | creating_doc | done | error`
- `transcript_text` (text, nullable)
- `summary_text` (text, nullable)
- `doc_id` (text, nullable)
- `doc_url` (text, nullable)
- `error_message` (text, nullable)
- `created_at`, `updated_at` (integer, default 0)

This is a brand-new table. The existing idempotent
`CREATE TABLE IF NOT EXISTS` migration adds it cleanly — the known silent-no-op
hazard only affects *column additions to existing tables*, not new tables. The
drift test must be extended to cover the new table.

**Pure functions (unit-tested, no I/O):**

- `planChunks(durationSec, chunkSec) -> { index, startSec, durationSec }[]`
  — fixed-duration boundaries with each chunk's start offset.
- `mergeSegments(chunkResults, offsets) -> { startSec, text }[]`
  — add each chunk's offset to its segment start times, concatenate in order.
- `formatTimestamp(sec) -> "HH:MM:SS"`.
- `buildTranscriptHtml(summary, segments) -> string`
  — `<h1>Summary</h1>` + summary paragraphs, then `<h1>Transcript</h1>` + one
  `[HH:MM:SS] text` line per segment. Plain HTML Drive can convert.
- `buildSummaryPrompt(transcript) -> messages` — Claude request for the summary.

**Orchestrator `runTranscription(id)`** — chains the five pipeline steps below,
updating the row as it goes; a thrown error in any step sets `status=error` +
`error_message` and stops (the uploaded file is left on disk). Same shape as the
existing `runRanking`.

### `packages/web/lib/` (impure wrappers, mockable)

- `audio.ts` — `probeDuration(path)`, `transcodeAndSegment(path, outDir, chunkSec)`
  using the `ffmpeg-static` binary path via `child_process`. Returns chunk file
  paths + offsets.
- `groq.ts` — `transcribeChunk(path) -> { segments }` against Groq
  `audio/transcriptions`, model `EE_TRANSCRIBE_MODEL` (default
  `whisper-large-v3-turbo`), `response_format: verbose_json`. Multipart upload.
- `anthropic.ts` — gains `summarizeTranscript(transcript)` reusing the existing
  client/setup.
- `google/docs.ts` — `createGoogleDoc(html, name) -> { id, url }` via Drive
  `files.create` (media upload + Google-Doc mimeType). Uses an authed Drive
  client with the widened scope.

### Pipeline (`runTranscription`)

1. **Upload** (in the route handler, before the orchestrator): stream the
   request body to `data/uploads/<id>/<filename>` — stream, do not buffer, so a
   multi-hundred-MB file does not exhaust memory. Insert the row, status
   `transcribing`, then fire-and-forget `runTranscription(id)`.
2. **Preprocess + chunk**: `probeDuration` → `planChunks` →
   `transcodeAndSegment` to 16kHz mono ~10-min chunks under `data/uploads/<id>/chunks/`.
3. **Transcribe**: `transcribeChunk` per chunk **sequentially** with 429/529
   exponential backoff (free tier is rate-limited). `mergeSegments` → ordered
   segment list; join into `transcript_text`. Status `summarizing`.
4. **Summarize**: `summarizeTranscript` → `summary_text`. Status `creating_doc`.
5. **Create doc**: `buildTranscriptHtml` → `createGoogleDoc` → store `doc_id`,
   `doc_url`. Status `done`.

## API

- `POST /api/transcribe` — streaming file upload (filename via header or query),
  creates the row, kicks off the pipeline, returns `{ id }`.
- `GET /api/transcribe/[id]` — `{ status, duration_sec, summary_text, doc_url,
  error_message }` for polling.

Single-user threat model: routes unauthenticated, consistent with the existing
Sorter/Studio routes.

## UI

- Landing page (`/`) gains an **Audio Transcriber** card.
- `/transcribe` — drag/drop or pick a file; while running, a phase label
  (transcribing / summarizing / creating doc) with chunk progress; on done, an
  "Open in Google Docs" link plus a summary preview; on error, the message with
  a retry affordance. Anti-vibecode tokens, LIGHT mode, matching the Sorter.
- `/settings` — two new rows: Groq (key present) and Google write access
  (re-consent prompt when only `drive.readonly` was granted).

## Error handling

- **Missing Groq key**: preflight in the route handler; set the row `error` with
  a clear message rather than stranding it mid-pipeline (same fix applied to the
  Sorter's missing-Anthropic-key case).
- **Google scope too narrow / token expired**: surface a re-consent prompt on
  `/settings` and inline at `creating_doc`; mark the row `error`.
- **Per-chunk transcription failure**: retry with backoff; on persistent
  failure mark the whole job `error` (a gap mid-transcript is worse than a clear
  failure).
- **ffmpeg failure / unreadable audio**: caught at preprocess, job `error`.
- **Rate limits**: chunks processed sequentially with exponential backoff; never
  parallel-flood Groq.

## Config / env

- `GROQ_API_KEY` — required for transcription.
- `EE_TRANSCRIBE_MODEL` — default `whisper-large-v3-turbo`.
- `EE_TRANSCRIBE_CHUNK_SEC` — default `600`.
- Google OAuth client scope list extended to include `drive.file`.

## Testing

- Unit: `planChunks` (boundaries, last partial chunk, offsets), `mergeSegments`
  (offset application + ordering across chunks), `formatTimestamp` (h/m/s
  padding, >1h), `buildTranscriptHtml` (sections + line format), drift test
  covers `transcriptions`.
- Orchestrator: `runTranscription` with `audio`/`groq`/`anthropic`/`docs`
  mocked — happy path + a per-step failure marks the row `error`.
- Live verification gated on the Groq key + Google re-consent (documented, run
  manually), same posture as Sorter ranking.

## Setup docs

`docs/setup/groq.md` (get a free key) and an update to the Google setup notes
covering the widened scope + re-consent.
