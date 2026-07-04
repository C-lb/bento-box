# Spec B — Batch E: background removal tool (MediaPipe)

Date: 2026-07-04
Status: design, pending review (revised after the @imgly AGPL block)

## Context

Build #9 shipped Spec B batches A–D (6 tools). This spec covers **Batch E —
background removal**, deferred from the original Spec B because it carries a real
engine decision. Batch F (certificate / badge mail-merge) remains a separate
later spec.

**Revision note:** the first cut of this spec chose `@imgly/background-removal`.
That library is **AGPL-3.0**, which for a closed-source internal SPARK tool that
bundles it client-side triggers the network-use source-disclosure clause and is
unusable without a paid commercial license (caught by a license gate before any
build). Caleb chose to switch to **MediaPipe** (Apache-2.0). This spec is the
MediaPipe design.

One new tool: **Remove a background** (`cutout`, `/cutout`) — drop a photo of a
person (or several), get each subject cut out onto transparency (or a solid
colour), download as a PNG. **Person-focused** (see scope note).

## Engine: MediaPipe Image Segmenter (client-side, Apache-2.0)

`@mediapipe/tasks-vision` runs a selfie / person **semantic segmentation** model
in the browser via WebAssembly — a neural net that outputs a per-pixel
confidence that each pixel is foreground (a person). We use that confidence as an
alpha matte to cut the subject out on a `<canvas>`. Apache-2.0, permissive, no
API key, the photo never leaves the machine, and **no native module** — so zero
added Electron packaging risk (the whole reason to stay client-side).

**Scope — person-focused.** The selfie segmenter is trained on people, so this
tool cuts out a person cleanly but will not reliably isolate an arbitrary object
(a product, a logo). That matches the app's real use (event photos of people /
headshots). The tool's copy says so plainly: "Best for photos of people." A
general-subject cutout would need a different (and, in this space, usually
non-commercial) model — out of scope.

## Established pattern (reuse)

Client-only, so it follows the **QR tool's shape**, not the server-tool shape:

- **`packages/core/src/cutout.ts`** — pure, tested helpers only (thin, like
  `qr.ts`): output-name derivation and background-fill option normalisation. No
  IO, no model code.
- **`packages/web/app/cutout/{page.tsx, CutoutClient.tsx}`** — a client component
  that dynamically imports `@mediapipe/tasks-vision`, runs the segmenter, and
  composites the cutout on a canvas, all in the browser. No `lib/cutout.ts`, no
  `app/api/cutout/**`, no job dir.
- **Register** in `packages/web/components/tools.ts`.

The multi-file "row per file" UX mirrors `HeicClient` / `ResizeClient`, but every
step runs client-side.

## Self-hosted assets

`@mediapipe/tasks-vision` needs two things at runtime, both self-hosted under
`packages/web/public/mediapipe/` so nothing hits a Google CDN (offline-capable,
private, ships in the desktop standalone):

1. **The WASM runtime** — the `wasm/` folder from the installed
   `@mediapipe/tasks-vision` npm package. Copied at pre-build (like Build #9's
   pattern), passed to `FilesetResolver.forVisionTasks("/mediapipe/wasm")`.
2. **The model** — the selfie segmenter `.tflite` (~250KB, hosted on Google's
   model storage, NOT in the npm package). A build script downloads it once into
   `public/mediapipe/` (skips if already present) and it is passed as
   `baseOptions.modelAssetPath`. At ~250KB it is small enough to commit instead
   of download if hermetic offline builds are wanted — see open items; default is
   the download-and-cache script.

Both live under a git-ignored `public/mediapipe/` and are populated by a
`predev`/`prebuild` step, exactly like the copy-assets approach scoped in Build
#9's plan. `public/` is included in the Next standalone output, so the desktop
app ships them and works offline.

## Tool design: Remove a background (`cutout`, `/cutout`)

- **UI**: multi-file drop (`accept="image/*"`). Each file → a row: original
  thumbnail, status (`idle | loading | busy | done | error`), and on completion a
  result preview on a **checkerboard backdrop** (so transparency reads) plus a
  Download button. A one-line helper: "Best for photos of people."
- **Background fill** (a `Segmented`): `Transparent | White | Custom colour`.
  Transparent → the cutout PNG with alpha. White/Custom → composite the cutout
  over that solid colour on the canvas and export that PNG. Default transparent.
- **Run** ("Remove backgrounds", `.btn.btn-accent`): loops rows **serially** (one
  at a time — segmentation + canvas work is memory-heavy). For each row:
  1. Ensure a single shared `ImageSegmenter` is created (once, cached across
     rows) from the self-hosted WASM fileset + model, in
     `runningMode: "IMAGE"` with `outputConfidenceMasks: true`.
  2. Decode the file to an `ImageBitmap`.
  3. `segmenter.segment(bitmap)` → a confidence mask (per-pixel person
     probability) at the image's dimensions.
  4. On a `<canvas>` sized to the image: draw the original, read its `ImageData`,
     and set each pixel's **alpha** from the mask (person confidence → opaque,
     background → transparent). If a fill colour is set, first fill the canvas
     with that colour and draw the masked subject over it. `canvas.toBlob(...,
     "image/png")`.
  5. Object URL → row `done` with `{ url, filename: cutoutOutName(name) }`.
  6. On throw, row `error` + message + per-row retry; the loop continues.
- **First-use load**: creating the `ImageSegmenter` downloads/compiles the WASM +
  model the first time; the active row shows a one-time "Preparing the background
  remover…" state, later runs reuse the cached segmenter.
- **Download**: `<a href={row.url} download={row.filename}>`.
- **Object-URL cleanup**: revoke result URLs on row removal AND on unmount using a
  ref synced to the live rows (the splice-tool pattern), NOT a `useEffect([])`
  cleanup closing over the initial empty rows (that stale-closure leak was a real
  splice bug).
- **SSR safety**: `CutoutClient` is `"use client"`; the
  `import("@mediapipe/tasks-vision")` and segmenter creation happen INSIDE the run
  handler, never at module top level (WASM must not load during SSR/build).
- **core/src/cutout.ts**:
  - `cutoutOutName(srcName)` → `<base>-cutout.png` (via `swapExt`).
  - `type BgFill = "transparent" | { color: string }`; `normalizeBgFill(raw:
    { mode?: string; color?: string })` → `#rrggbb` validated, `"transparent"`
    default, white → `#ffffff`.
  - `maskToAlpha` decision is inline in the client (touches `ImageData`); core
    stays pure/DOM-free. Optionally a pure `alphaFromConfidence(conf: number,
    threshold?: number): number` helper if it helps testing — keep core DOM-free.

## Registry addition (`components/tools.ts`)

| id | title | group | lucide icon | tags |
|----|-------|-------|-------------|------|
| `cutout` | Remove a background | images | `Eraser` | background, remove, cutout, transparent, png, person, photo |

`Eraser` verified to exist in `lucide-react` during implementation (swap if
missing). Group `images` already exists.

## Packaging

- **No native module** — nothing to unpack from asar, no ABI concern.
- Self-hosted WASM + model live under `packages/web/public/mediapipe/` and ship
  in the Next standalone `public/` output, so the packaged desktop app has them
  and works offline. Confirm the desktop `assemble-server` copies `public/` (it
  already must, for existing assets) — a verification point, not new work.

## Error handling

- A file that fails (decode error, segmenter failure) → that row `error` with a
  readable message + per-row retry; other rows unaffected (serial loop continues).
- If the WASM/model fail to load (missing `/mediapipe/` — a build-wiring failure),
  the first run surfaces "Could not load the background remover" rather than a raw
  stack.

## Testing

- **core** unit tests: `cutoutOutName` (extension swap, sanitisation),
  `normalizeBgFill` (transparent default, white → `#ffffff`, custom hex validate,
  junk → transparent), and `alphaFromConfidence` if added.
- The segmenter + canvas compositing are not unit-tested (browser WASM + DOM).
  Build check: `next build` succeeds and `@mediapipe/tasks-vision` bundles into
  the client without node-only built-ins.
- **Manual**: a real photo of a person → transparent PNG with the background gone
  and a reasonably clean person edge; a second run reuses the model (no
  re-download); White fill → white-background PNG; a batch of 3 processes serially.

## Build / sequencing

One tool, three tasks:

1. **Asset infra** — add `@mediapipe/tasks-vision`; a script that copies the
   package `wasm/` and downloads the selfie `.tflite` into
   `public/mediapipe/` (skip-if-present); wire `predev`/`prebuild`; git-ignore
   `public/mediapipe/`; record the exact model URL + the `FilesetResolver`/
   `modelAssetPath` values Task 2 needs.
2. **The tool** — `core/src/cutout.ts` (TDD) + `app/cutout/{page,CutoutClient}`
   with the segmenter + canvas-composite flow and correct object-URL cleanup.
3. **Registry + smoke** — register `cutout`; `next build` lists `/cutout` and
   bundles the library; live smoke.

Subagent-driven, per-task reviewer gate, atomic commits, push to main.

## Open items for review

- **License** — `@mediapipe/tasks-vision` is Apache-2.0 (confirmed direction);
  Task 1 re-confirms the installed package's license field + the model's terms
  before building.
- **Model hosting** — download-and-cache script (default) vs commit the ~250KB
  `.tflite` for hermetic offline builds. Default download.
- **Which model** — the plain `selfie_segmenter.tflite` (person vs background) is
  the MVP; the `selfie_multiclass` model (hair/skin/clothes classes) is available
  if finer control is wanted later. Default: single-class selfie segmenter.
- **Background fill** — ship Transparent/White/Custom (default) or transparent
  only. Default: include the fill option.
- **Edge quality** — MediaPipe person edges (esp. hair) are softer than a
  dedicated matting model; acceptable for the MVP. A feathering/threshold tweak
  can be a follow-up.
