# Spec B — Utility tools batch (A–D): 6 new converters

Date: 2026-07-04
Status: design, pending review

## Context

Build #8 shipped the tool-discovery shell (registry, groups, favourites,
search) sized to hold 13+ tools. The registry (`packages/web/components/tools.ts`)
currently holds 5 tools. Spec B adds 8 new tools, each a self-contained card in
the shell.

The 8 divide by shared dependency into batches. This spec covers **Batches A–D
(6 tools)** — the mechanical, low-risk converters. The two tools that carry real
design questions get their own follow-up spec:

- **Batch E — background removal** (needs an ONNX model, ~40MB managed download;
  model-choice + download-UX decisions).
- **Batch F — certificate / badge mail-merge** (template + data → batch output;
  effectively a mini-app, not a converter).

### The 6 tools in scope

| # | Tool | id / route | Dep (already installed unless noted) |
|---|------|-----------|--------------------------------------|
| 1 | HEIC → jpg/png | `heic` `/heic` | `heic-convert` **(new)** |
| 2 | Image compress / resize | `resize` `/resize` | `sharp` |
| 3 | PDF merge / split / compress | `pdf` `/pdf` | `pdf-lib`, `jszip` |
| 5 | Video compression | `video` `/video` | `ffmpeg-static` |
| 6 | Video concat | `concat` `/concat` | `ffmpeg-static` |
| 7 | QR generator | `qr` `/qr` | `qrcode` **(new)** |

(Tools 4 = bg-removal and 8 = mail-merge are Batches E/F, deferred.)

New dependencies to add to `packages/web`: `heic-convert`, `qrcode`,
`@types/qrcode`. Everything else (`sharp`, `pdf-lib`, `jszip`, `archiver`,
`ffmpeg-static`) is already a web dependency.

## Established pattern (reuse, do not reinvent)

Every existing tool follows this shape; the 6 new tools follow it exactly.

- **`packages/core/src/<tool>.ts`** — pure, side-effect-free helpers
  (arg-builders, filename derivation, option validation, page-range parsing).
  Unit-tested in `packages/core/test`. No IO. Exported via package subpaths
  (`@event-editor/core/<tool>`); rebuild core after changes.
- **`packages/web/lib/<tool>.ts`** — IO: reads the job dir, spawns binaries or
  calls sharp/pdf-lib, writes output.
- **`packages/web/app/api/<tool>/…/route.ts`** — `runtime = "nodejs"`. `POST`
  multipart form (one file per request), creates a job dir, processes, returns
  `{ id, filename }`. A `GET /api/<tool>/[id]` route streams the output for
  download.
- **`packages/web/app/<tool>/{page.tsx, <Tool>Client.tsx}`** — server page +
  client component. Anti-vibecode house style.
- **Register** in `packages/web/components/tools.ts`.

### Job / working-dir machinery

`lib/convert.ts` already implements job dirs (`dataRoot()` honouring
`EE_DATA_DIR`, `newConvertId()`, `sanitizeConvertId()`, `convertDir()`,
`cleanup*`, `sweepOld*`, and a private `run(bin, args)` spawn helper) — but named
`convert*` and not exported for reuse.

**Extract shared infra** into two small modules (justified: five of six tools
need it):

- `packages/web/lib/jobs.ts` — `dataRoot()`, `newJobId()`, `sanitizeJobId()`,
  `jobDir(tool, id)` = `resolve(dataRoot(), tool, sanitizeJobId(id))`,
  `cleanupJob(tool, id)`, `sweepOldJobs(tool, maxAgeMs)`.
- `packages/web/lib/spawn.ts` — the `run(bin, args): Promise<string>` helper
  (used by the two ffmpeg tools).

`lib/convert.ts` stays as-is (no unrelated refactor); new tools import from
`jobs.ts` / `spawn.ts`. Each job dir holds `source*` inputs and a named output.
`sweepOldJobs(tool, 6h)` is called best-effort on each POST, matching convert.

### One-file-per-request model

Convert processes one file per request and returns `{ id, filename }`; the client
renders a row per file with its own download link, and "download all" just
triggers each link. The multi-file tools (HEIC, resize) reuse this: the client
loops selected files, one POST each, one row each. **No server-side zipping** for
these — avoids bundling archive output and keeps each file independently
retriable. (PDF split is the exception — see §3.)

## Tool designs

### 1. HEIC → jpg/png (`heic`, `/heic`)

iPhone `.heic`/`.heif` photos → web-friendly jpg or png.

- **UI**: multi-file drop (accept `.heic,.heif`), format radio `jpg | png`,
  quality slider (jpg only, default 82), a row per file with status + download.
- **core/src/heic.ts**: `heicOutName(srcName, fmt)` (swap extension, sanitise),
  `clampQuality(n)`, format guard.
- **lib/heic.ts**: `heicToImage(buf, fmt, quality)` — `heic-convert`
  (`{ format: 'JPEG'|'PNG', quality }`) → output buffer. Pure-JS/wasm (libheif),
  no native binary, no packaging concern.
- **api/heic/route.ts**: POST `{ file, format, quality }` → job dir → write
  source → convert → write `out.<ext>` → `{ id, filename }`.
- **api/heic/[id]/route.ts**: stream `out.*` with a download filename.

### 2. Image compress / resize (`resize`, `/resize`)

Shrink dimensions and/or re-encode any common image.

- **UI**: multi-file drop (jpg/png/webp/heic-not-here → jpg/png/webp only), max
  width and max height inputs (fit inside, keep aspect, never enlarge), output
  format `keep | jpg | png | webp`, quality slider (lossy formats). Row per file
  with before/after size.
- **core/src/resize.ts**: `normalizeResizeOpts({maxW, maxH, format, quality})`
  (clamp, defaults, validate), `resizeOutName(srcName, format)`.
- **lib/resize.ts**: `resizeImage(buf, opts)` — `sharp(buf).resize({ width,
  height, fit: 'inside', withoutEnlargement: true }).toFormat(fmt, { quality })`.
- **api/resize/route.ts** + **[id]** as above; response includes `bytesIn` /
  `bytesOut` so the client can show the reduction.

### 3. PDF merge / split / compress (`pdf`, `/pdf`)

One tool, three modes (segmented control — reuse the house segmented pill).

- **Merge**: multi-PDF upload, drag to reorder, → one PDF. `pdf-lib`
  `copyPages` across docs in order.
- **Split**: one PDF upload, page-range spec text (e.g. `1-3, 5, 8-10`), →
  **one PDF per range**, returned as a `.zip` (jszip — already a dep; multiple
  outputs genuinely need bundling here). A "single PDF of selected pages" toggle
  produces one file instead.
- **Compress**: one PDF upload → `pdf-lib` re-save with
  `useObjectStreams: true`. **Honest scope**: this de-duplicates objects and
  rewrites the xref as an object stream — modest gains on bloated PDFs, and it
  does **not** recompress embedded images (that needs Ghostscript, which is not
  bundled). UI copy states this plainly ("tidies structure; won't shrink
  image-heavy PDFs"). Real image recompression is out of scope for this batch.
- **core/src/pdf.ts**: `parsePageRanges(spec, pageCount)` → validated
  `number[][]` (pure, well-tested — the fiddly bit), `pdfOutName(...)`.
- **lib/pdf.ts**: `mergePdfs(buffers)`, `splitPdf(buffer, ranges, {single})`,
  `resavePdf(buffer)`.
- **api/pdf/[mode]/route.ts** (mode in `merge|split|compress`) → job dir →
  output(s) → `{ id, filename }`; **[id]** streams the pdf or zip.

### 5. Video compression (`video`, `/video`)

Re-encode a video smaller with a friendly preset instead of raw CRF.

- **UI**: single video upload, preset radio `Smaller | Balanced | Best quality`
  (CRF 28 / 23 / 20), optional max resolution `keep | 1080p | 720p`, output is
  mp4 (h264 + aac). Shows before/after size on completion.
- **core/src/video.ts**: `ffmpegCompressArgs(inPath, outPath, { crf, scale })`
  (pure; `scale` → `-vf scale=-2:720` etc., `-2` keeps even dims).
- **lib/video.ts**: `compressVideo(inPath, outPath, opts)` via `spawn.run` +
  `ffmpeg-static`. Reuses `ffmpegDir()`-style bundled path (already proven by
  convert).
- **api/video/route.ts** + **[id]**.

### 6. Video concat (`concat`, `/concat`)

Join clips end to end.

- **UI**: multi video upload, drag to reorder, target resolution
  `match first | 1080p | 720p`, → one mp4.
- **Approach**: re-encode via `filter_complex` `concat` (scale each input to the
  target so mismatched sources still join cleanly) rather than the stream-copy
  demuxer (which fails on differing codecs/params). Slower but robust — correct
  default for user-supplied clips.
- **core/src/concat.ts**: `ffmpegConcatArgs(inPaths, outPath, { scale })` (pure;
  builds the `-i … -filter_complex "[0:v]scale…[v0];…concat=n=N:v=1:a=1"` graph).
- **lib/concat.ts**: `concatVideos(inPaths, outPath, opts)`.
- **api/concat/route.ts** accepts multiple files in one POST (exception to
  one-file-per-request — concat is inherently multi-input) → **[id]**.

### 7. QR generator (`qr`, `/qr`)

Text/URL → QR image. Fully client-side (no upload, no job dir, no API route).

- **UI**: text/URL input, size slider, error-correction `L|M|Q|H`, foreground +
  background colour, output `PNG | SVG`, live preview, download. No logo embed in
  MVP.
- **lib**: `qrcode` runs in the browser — `QRCode.toDataURL` (png) /
  `QRCode.toString({ type: 'svg' })`. Bundled into the Next client build.
- **core/src/qr.ts**: `normalizeQrOpts(...)` (clamp size, validate hex colours,
  ecc guard) — pure, shared with any future server use.
- No API route, no `[id]` route. Simplest tool; still a first-class card.

## Registry additions (`components/tools.ts`)

Six new `Tool` entries. Proposed grouping (existing groups: `images`,
`documents`, `media`, `events`; **new group `utilities`** for QR):

| id | title | groups | lucide icon | tags |
|----|-------|--------|-------------|------|
| `heic` | Convert HEIC photos | images | `FileImage` | heic, iphone, jpg, png, photo |
| `resize` | Compress or resize images | images | `Shrink` | resize, compress, image, shrink |
| `pdf` | Merge, split, or shrink PDFs | documents | `Files` | pdf, merge, split, compress |
| `video` | Compress a video | media | `Film` | video, compress, mp4, shrink |
| `concat` | Join videos together | media | `Combine` | video, concat, join, merge, mp4 |
| `qr` | Make a QR code | utilities | `QrCode` | qr, code, link, url |

`utilities` needs adding to the tool-store default group order + labels
(`components/tool-store.ts`). Icons verified to exist in `lucide-react` during
implementation (swap if any is missing).

## Packaging

No new concern. The desktop app ships the Next standalone server as
`extraResources` (`build/server`) with its own `node_modules`, so `sharp` and
`ffmpeg-static` native binaries already resolve there (the existing image tools
prove this). `heic-convert` is pure JS/wasm; `qrcode` is client-bundled. Nothing
to unpack from asar.

## Error handling

Mirror convert: on any processing error, `cleanupJob`, return
`{ error: message }` with 500; the client surfaces it inline on the file's row
with a retry. Guards: empty/oversized files rejected with 400 (reuse convert's
size posture), unsupported input format rejected before processing, page-range
spec errors returned as 400 with a readable message.

## Testing

- **core** unit tests (the valuable ones — pure logic): `parsePageRanges` (ranges,
  singles, whitespace, out-of-bounds, overlaps, descending), `ffmpegCompressArgs`
  / `ffmpegConcatArgs` (correct flags per preset/scale), `normalizeResizeOpts` /
  `normalizeQrOpts` clamping, all `*OutName` filename derivations.
- **web** route tests where cheap: HEIC/resize/pdf happy path + bad-input 400,
  following `convert-route.test.ts`.
- **Manual**: real .heic photo, an image-heavy vs text PDF through compress
  (verify the honest-copy claim), two differently-encoded clips through concat,
  QR PNG + SVG download.

## Build / sequencing

Build in dependency batches, each an independent shippable slice:

1. **Shared infra** — `lib/jobs.ts`, `lib/spawn.ts` (+ tests).
2. **Batch A (images)** — `heic`, `resize`. Adds `heic-convert`.
3. **Batch B (PDF)** — `pdf`.
4. **Batch C (AV)** — `video`, `concat`.
5. **Batch D (QR)** — `qr`. Adds `qrcode`.
6. **Registry + `utilities` group** — wire all six into the shell; live smoke.

Each batch: subagent-driven task with a reviewer gate, atomic commits, push to
main.

## Open items for review

- **PDF compress honest scope** — confirm the pdf-lib-only MVP (structural
  re-save, no image recompression) is acceptable, or bump PDF-compress to a
  Ghostscript-backed follow-up and ship merge/split now.
- **QR client-only** — confirm no server route wanted (no persisted history for
  QR, unlike other tools). Default: client-only.
- **`utilities` group** — new group vs folding QR into an existing one.
- **Zip for PDF split** — confirm zip-of-parts default (vs one merged PDF of
  selected pages as the primary output).
