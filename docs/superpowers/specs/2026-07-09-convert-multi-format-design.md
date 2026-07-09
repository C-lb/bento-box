# Convert: multi-format file converter — design

**Date:** 2026-07-09
**Status:** Pending combined spec+plan review
**Product:** Bento (event-editor)

## Problem

The `/convert` tool only does one thing: audio/video → mp3 (from a YouTube link
or an uploaded file). Everything else in the app that changes a file's format is
scattered across separate tools (resize for images, heic for HEIC, pdf for PDF
structure) and there is no way to, say, turn a PNG into a PDF or a PDF page into
a PNG. Users expect a general "convert this file to that format" tool.

## Goal

Broaden `/convert` into a general single-file converter. The user uploads a file
(or pastes a link, unchanged); the tool detects the input's category and offers
an **output-format dropdown** of the valid targets for that input; the user picks
a format and converts. The existing YouTube/link → mp3 flow stays exactly as-is.

### Supported conversions (v1)

| Input | Output options | Engine |
|-------|----------------|--------|
| Image: png, jpg/jpeg, webp | png, jpg, webp, pdf | sharp (raster), pdf-lib (→pdf) |
| Image: heic/heif | png, jpg, pdf | heic-convert → sharp/pdf-lib |
| PDF | png, jpg (one image per page; multi-page → zip) | pdfjs-dist + @napi-rs/canvas |
| Audio/video (uploaded) | mp3, wav, m4a | ffmpeg (bundled) |
| Link (YouTube/URL) | mp3 (unchanged) | yt-dlp + ffmpeg |

Out of scope for v1 (explicitly): batch/multi-file rows (stays single-file like
today), resizing/quality sliders (the `resize` tool owns that; convert uses fixed
sensible quality), document formats needing LibreOffice (docx/pptx), video output
formats (the `video` tool owns transcoding). Flagged for veto in review.

## UX

The page keeps its `Segmented` [From link | Upload file] control.

- **From link:** unchanged. URL → mp3, name, download, Save to Drive.
- **Upload file:** after a file is chosen, the tool reads its extension, resolves
  the input category, and renders an **Output format** `Segmented`/dropdown
  populated with that category's allowed outputs. The first option is the default.
  A file whose type isn't recognized shows "This file type isn't supported yet"
  and no convert button. Convert → progress bar (existing `uploadWithProgress`) →
  Download + Save to Drive, exactly like the current audio result.

The output-format control only appears in file mode, only once a file is selected.
Switching files re-derives the options (and resets the choice if the previous
format is no longer valid).

## Architecture

Five layers. The pure catalog and per-engine converters are independently
testable; the route and dispatcher wire them together.

### 1. Format catalog — pure (`packages/core/src/convert-formats.ts`, new)

Single source of truth for what converts to what. No I/O.

```ts
export type ConvertCategory = "image" | "heic" | "pdf" | "audio";
export type OutputFormat = "png" | "jpg" | "webp" | "pdf" | "mp3" | "wav" | "m4a";

// Detect the input category from a filename (extension, lower-cased).
export function categoryForFile(filename: string): ConvertCategory | null;

// Allowed outputs for a category, in display order (first = default).
export function outputsFor(category: ConvertCategory): OutputFormat[];

// Guard used by the route: is this output valid for this input file?
export function isValidConversion(filename: string, output: OutputFormat): boolean;

// The file extension an output writes (jpg→"jpg", etc.); zip handled by caller.
export function extFor(output: OutputFormat): string;

// "<base>.<ext>" or "<base>-pages.zip" for multi-page pdf→image.
export function convertOutName(srcName: string, output: OutputFormat, zip: boolean): string;
```

Category map (by extension): image = png/jpg/jpeg/webp; heic = heic/heif; pdf =
pdf; audio = mp3/wav/m4a/aac/flac/ogg/opus/mp4/mov/mkv/webm/avi/m4v. Outputs:
image → [png, jpg, webp, pdf]; heic → [png, jpg, pdf]; pdf → [png, jpg]; audio →
[mp3, wav, m4a].

### 2. Per-engine converters — server (`packages/web/lib/convert-file.ts`, new)

Each takes an input buffer/path and returns `{ data: Buffer; ext: string }` (or
writes to the job dir). Reuse existing libs; add only pdf→image.

- **image → png/jpg/webp:** `sharp(input).png()/.jpeg()/.webp()` (fixed quality
  82 for lossy). Mirrors `lib/resize.ts` minus the resize step.
- **heic → png/jpg:** `heicToImage` from `lib/heic.ts` (already returns png/jpeg).
- **image/heic → pdf:** normalize to PNG bytes via sharp (or heic-convert first
  for heic), then `PDFDocument.create()` → `embedPng` → one page sized to the
  image → `save()`. New small function beside `lib/pdf.ts` (it already imports
  pdf-lib). No new dep.
- **pdf → png/jpg:** render each page with `pdfjs-dist` (legacy Node build) onto
  an `@napi-rs/canvas` canvas at ~2x scale, encode png/jpeg. Single page → one
  image; multiple pages → `zipFiles` (already in `lib/pdf.ts`) of `page-1.png` …
- **audio/video → mp3/wav/m4a:** generalize the existing ffmpeg path. Add
  `audioArgs(inPath, outPath, format)` in `packages/core/src/convert.ts` beside
  `ffmpegMp3Args` (mp3→libmp3lame 192k; wav→pcm_s16le; m4a→aac 192k). A new
  `transcodeAudio(inPath, id, format)` in `lib/convert.ts` writes `out.<ext>`.

### 3. Dispatcher (`packages/web/lib/convert-file.ts`)

```ts
export async function convertUploaded(
  inputPath: string, inputName: string, output: OutputFormat,
): Promise<{ ext: string; zip: boolean }>;
```

Reads the category via the catalog, calls the right engine, writes the result
into the job dir as `out.<ext>` (or `out.zip`), returns what was written. Throws
on an invalid (input, output) pair — the route validated already, this is defense.

### 4. Route — generalize `POST /api/convert/file`

The existing route is audio-only (`transcodeToMp3` → `out.mp3`). Generalize:

- Read an `output` form field (an `OutputFormat`). If absent, default `mp3`
  (backward compatible with any current caller).
- Validate `isValidConversion(file.name, output)`; 400 on mismatch.
- If `output` is an audio format → `transcodeAudio`; else → `convertUploaded`.
- Return `{ id, filename: convertOutName(...), ext }` (add `ext`, and `zip` flag).

Keep the existing `convertDir`/`newConvertId`/sweep helpers (audio path already
uses them) so the working flow is untouched; the new engines write into the same
job dir. Download route `/api/convert/[id]` gains an `?ext=` param (defaults to
`mp3`) and serves `out.<ext>` with a content-type map (mirror the `resize`
download route). Drive-save reads the same `out.<ext>`.

### 5. UI (`app/convert/ConvertClient.tsx`, `app/convert/page.tsx`)

- Add `output` state and, in file mode, derive `outputsFor(categoryForFile(name))`
  when a file is chosen. Render an **Output format** `Segmented` (reuse the
  component) below the file picker. Reset `output` to the first option when the
  file (hence category) changes; show the unsupported message when category is null.
- On submit, append `output` to the FormData; on result, build the download URL
  with `?ext=${ext}`.
- Page `<h1>` becomes "Convert a file"; the link-mode copy stays about audio.

## Dependencies

- **`pdfjs-dist`** (Apache-2.0) — PDF page rasterization.
- **`@napi-rs/canvas`** (MIT) — canvas backend pdfjs renders onto. **Native
  module, but prebuilt N-API** (ABI-stable, ships platform binaries), so it
  follows the exact `sharp` treatment in this repo, NOT the better-sqlite3
  rebuild path. The app does not use electron-builder `asarUnpack`; native
  addons ship outside the asar via the desktop assemble step. Three edits make
  it ship in the packaged app:
  1. add `@napi-rs/canvas` to `serverExternalPackages` in
     `packages/web/next.config.ts` (so Next externalizes it instead of bundling);
  2. add a `cpSync` block in `packages/desktop/scripts/assemble-server.mjs`
     copying `node_modules/@napi-rs/canvas` and its `@napi-rs/canvas-<platform>`
     package into `build/server/node_modules` (mirroring the sharp/@img block);
  3. add `@napi-rs/canvas` to the `externals` list of the `module._load` shim
     injected by that script.
  No `@electron/rebuild` entry is needed (N-API, like sharp); optionally add it
  to the `VERIFY` dlopen check in `rebuild-native.mjs`. This packaging work is
  the main integration risk and gets its own plan task with a packaged-app smoke.

Everything else (sharp, pdf-lib, heic-convert, ffmpeg-static, yt-dlp) is already
present.

## House style

Output-format control uses the existing `Segmented` component (consistent with
the mode toggle and the `resize` tool). Sentence-case labels ("PNG", "JPG",
"WEBP", "PDF", "MP3", "WAV", "M4A" are format names, acceptable upper-case).
Plain copy, no em dashes. Every state (loading spinner, error text, success
download) reuses the tool's existing patterns.

## Error handling

- Unsupported input type → no convert button, inline "This file type isn't
  supported yet" (not an error toast).
- Invalid (input, output) reaching the route → 400 with a plain message.
- Engine failure (corrupt file, encrypted PDF) → 500 with the error message, job
  dir cleaned up (existing `cleanupConvert` pattern).
- Encrypted/passworded PDFs: pdfjs throws; surface "This PDF is protected and
  can't be converted."

## Testing

- **Core (`convert-formats.test.ts`):** category detection per extension;
  `outputsFor` per category; `isValidConversion` accept/reject; `extFor`;
  `convertOutName` single vs zip.
- **Core (`convert.test.ts`):** `audioArgs` for mp3/wav/m4a produce the expected
  ffmpeg argv.
- **Web lib (`convert-file.test.ts`):** image→png/jpg/webp round-trips (feed a
  tiny generated PNG via sharp, assert output is decodable and the right format);
  image→pdf produces a valid PDF (pdf-lib re-parse, 1 page); pdf→png renders the
  expected page count (small 2-page PDF fixture → zip with 2 entries).
- **Route:** posting `output=png` with a PNG returns `ext:"png"`; an invalid pair
  (audio file + `output=pdf`) returns 400; omitting `output` still yields mp3.
- **Manual (packaged app):** real files each direction, including a multi-page PDF
  → zip, on the built desktop app to prove `@napi-rs/canvas` is packaged.

## Files touched

- `packages/core/src/convert-formats.ts` (new) + test
- `packages/core/src/convert.ts` (add `audioArgs`) + test
- `packages/web/lib/convert-file.ts` (new: engines + dispatcher) + test
- `packages/web/lib/convert.ts` (add `transcodeAudio`)
- `packages/web/app/api/convert/file/route.ts` (generalize)
- `packages/web/app/api/convert/[id]/route.ts` (arbitrary ext)
- `packages/web/app/convert/ConvertClient.tsx` (output dropdown)
- `packages/web/app/convert/page.tsx` (title)
- `packages/web/components/tools.ts` (convert title/body/tags)
- `packages/web/package.json` (+pdfjs-dist, +@napi-rs/canvas)
- `packages/web/next.config.ts` (`serverExternalPackages` += @napi-rs/canvas)
- `packages/desktop/scripts/assemble-server.mjs` (copy @napi-rs/canvas + platform pkg; add to `module._load` externals shim)
- `packages/desktop/scripts/rebuild-native.mjs` (optional: add @napi-rs/canvas to the VERIFY dlopen check)
