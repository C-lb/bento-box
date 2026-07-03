# Audio converter — design

Date: 2026-07-03
Status: approved, ready for planning

## Goal

A new standalone tool that turns a media **link** (YouTube, video hosts, direct
media URLs) or an uploaded **audio/video file** into an mp3, with an editable
output filename that prefills to a sensible default. Delivered both as a browser
download and an optional save to Google Drive.

## Placement

New standalone tool, peer to the existing four:

- Route: `/convert`
- Nav entry in `packages/web/components/nav-links.ts` (label "Audio converter",
  lucide `AudioLines` icon)
- Home card in `packages/web/app/page.tsx` TOOLS array
- Page files: `packages/web/app/convert/page.tsx` + `ConvertClient.tsx`

## Input modes

One card with a segmented toggle: **From link** / **Upload file**.

### From link
- User pastes a URL (YouTube, video-hosting sites, or a direct media URL — any
  source `yt-dlp` supports).
- Extraction: `yt-dlp -x --audio-format mp3 --audio-quality 192K -o <tmp>/<id>.%(ext)s <url>`.
  yt-dlp shells out to the already-installed `ffmpeg` for the encode, so both
  modes produce 192 kbps mp3.
- Default filename: `yt-dlp --print title <url>` on paste (see Filename).

### Upload file
- Accepts audio **and** video. Picker `accept="audio/*,video/*"`, with a helper
  line naming common formats: mp4, mov, mkv, webm, avi, m4v (video) and mp3, wav,
  m4a, aac, flac, ogg (audio). ffmpeg handles any container it can demux.
- Transcode / audio-strip: `ffmpeg -i <in> -vn -c:a libmp3lame -b:a 192k <out>.mp3`.

Encoding fixed at **192 kbps** for v1. Bitrate selection is a later add.

## Filename

A single always-editable text field, prefilled with a default:

- Link mode: sanitized `yt-dlp --print title` output.
- File mode: the uploaded file's base name (extension stripped).

On convert, the filename is sanitized regardless of source: strip directory
separators and control/unsafe characters, collapse whitespace, trim, cap length,
and force exactly one trailing `.mp3`. Empty-after-sanitize falls back to a
timestamped default like `audio-<epoch>.mp3`. The same resolved name is used for
both the download and the Drive save.

## Output — both

After a successful convert, the result panel shows the resolved filename plus:

- **Download** — streams the mp3 from `GET /api/convert/[id]` with a
  `Content-Disposition: attachment; filename="<name>.mp3"`.
- **Save to Drive** — `POST /api/convert/drive-save` writes the mp3 to Drive via
  the existing Google integration (`getConnections()` / drive helpers), returning
  the Drive file link.

## Backend structure (mirrors the slicer)

Pure, unit-testable core plus thin API/exec layer.

- `packages/core/src/convert.ts`
  - `sanitizeFilename(raw: string): string` — the sanitize rules above.
  - `defaultNameFromFile(originalName: string): string`
  - `ytDlpTitleArgs(url)`, `ytDlpExtractArgs(url, outStem)`, `ffmpegMp3Args(inPath, outPath)`
    — pure argv builders (no spawning), so they can be asserted in tests.
  - a thin `run(cmd, args)` exec wrapper (spawn, collect stdout/stderr, exit code).
  - `hasYtDlp(): Promise<boolean>` — presence check for the gate.
- API routes under `packages/web/app/api/convert/`:
  - `POST title` — `{ url }` → `{ title }` for prefill.
  - `POST url` — `{ url, filename? }` → runs yt-dlp, stores the mp3 in the working
    dir, returns `{ id, filename }`.
  - `POST file` — multipart upload → ffmpeg → `{ id, filename }`.
  - `GET [id]` — stream the mp3 as a download.
  - `POST drive-save` — `{ id, filename }` → Drive upload → `{ link }`.
- Ephemeral working dir `data/convert/` (peer of `data/slice/`), each conversion
  keyed by a generated id; cleaned after delivery / on a best-effort basis.

## yt-dlp gate

`yt-dlp` is a required local binary (install: `brew install yt-dlp`), same
external-dependency pattern as the slicer's LibreOffice.

- Link mode: if `hasYtDlp()` is false, render a setup card ("Install yt-dlp to
  convert from links: `brew install yt-dlp`") in place of the URL form.
- File mode: always available (ffmpeg only, already installed).
- Settings page: add a presence indicator/pill for yt-dlp alongside the existing
  connection pills.

## UI (anti-vibecode house standards)

- Header: no eyebrow, `<h1>` "Convert audio to mp3" (matches the current header
  style across tools).
- Segmented toggle for the two modes; one card, single padding, no nesting.
- Link mode: URL input; on paste/blur, fetch the default title and prefill the
  filename field. Filename field below. Primary "Convert" button (the single
  accent action).
- File mode: file picker / drop area with the supported-formats helper line; on
  select, prefill filename from the file. "Convert" button.
- During conversion: button goes to `.is-loading` (spinner, disabled) with a
  status line (yt-dlp can take a while).
- Result: filename + Download + Save to Drive, with a success confirmation.
- Error states: invalid/unsupported URL, yt-dlp missing (setup card), unsupported
  or unreadable file, conversion failure — each with a clear, human message.

## Out of v1 (YAGNI — flagged for later)

- A "past conversions" history panel like the other tools.
- Playlist / batch URL handling.
- Bitrate / format selection.

## Caveat

Pulling audio from YouTube can conflict with their Terms of Service. The tool
assumes the user has rights to the content (own event recordings, licensed
media). Not enforced, stated here for awareness.
