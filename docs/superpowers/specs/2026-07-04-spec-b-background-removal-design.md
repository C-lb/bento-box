# Spec B — Batch E: background removal tool

Date: 2026-07-04
Status: design, pending review

## Context

Build #9 shipped Spec B batches A–D (6 tools). This spec covers **Batch E —
background removal**, one of the two tools deferred from the original Spec B
because it carries a real design decision (which inference engine). Batch F
(certificate / badge mail-merge) remains a separate later spec.

One new tool: **Remove a background** (`cutout`, `/cutout`) — drop a photo (or
several), get each subject cut out onto transparency, download as a PNG.

## The engine decision (primary, flag for veto)

Background removal runs a U^2-Net-style semantic segmentation model — a neural
net that classifies each pixel as foreground (subject) or background, producing
an alpha matte the tool applies to cut the subject out. Hosted APIs (remove.bg,
Replicate) are ruled out: they send confidential event photos to a third party,
cost per image, and need a key — all against this app's local-and-private ethos.

That leaves running the model locally. Two ways, and the fork changes the whole
build:

- **CHOSEN — client-side WASM.** `@imgly/background-removal` runs the model in
  the browser via ONNX Runtime Web (WebAssembly). Like the QR tool: **no API
  route, no job dir, the photo never leaves the browser.** No native module, so
  **zero added Electron packaging risk** — which matters because the desktop app
  already went through a multi-fix debugging saga getting `better-sqlite3` and
  `sharp` native binaries to resolve in the relocated bundle. Cost: first use
  loads ~40MB of model + WASM assets (cached after), and WASM inference is
  slower than native (a few seconds per photo). Acceptable for headshot-scale
  batches.
- Rejected for this batch — server-side native (`@imgly/background-removal-node`
  via `onnxruntime-node`): faster, and fits the existing yt-dlp "managed
  dependency" UX, but adds another native binary that must resolve in the
  packaged desktop app — the exact ABI/relocation bug class that cost real time
  before. Not worth it for a single tool when the WASM path is private and works.

If you'd rather take the server-side path, this spec's architecture changes
substantially (route + job dir + native-module packaging work) — say so before
the plan is executed.

## Model asset hosting (secondary decision)

`@imgly/background-removal` fetches its model + WASM assets from IMG.LY's CDN by
default. The CDN only serves the *model*, never the image, so privacy holds
either way — but the desktop app is offline-capable, so relying on a CDN would
break it with no internet. Therefore **self-host the assets**:

- Add `@imgly/background-removal-data` as a dependency (the model/WASM dist as an
  npm package, version-pinned alongside the library).
- A build step copies `node_modules/@imgly/background-removal-data/dist/*` into
  `packages/web/public/imgly/` (git-ignored — it is a copy of a dependency, not
  source), wired into `predev` and `prebuild` so it is always present before the
  app runs or builds.
- Configure the library with `publicPath: "/imgly/"` so it loads from the app's
  own origin. Assets in `public/` are included in the Next standalone output, so
  they ship inside the packaged desktop app and work offline.

Alternative (open item): commit the assets to the repo (+~40MB) instead of the
copy step, or keep the CDN default and accept online-only first use. Default is
the copy step.

## Established pattern (reuse)

This tool is client-only, so it follows the **QR tool's shape**, not the
server-tool shape:

- **`packages/core/src/cutout.ts`** — pure, tested helpers only (thin, like
  `qr.ts`): output-name derivation and background-fill option normalisation. No
  IO, no model code.
- **`packages/web/app/cutout/{page.tsx, CutoutClient.tsx}`** — a client
  component that dynamically imports `@imgly/background-removal` and does the
  work in the browser. No `lib/cutout.ts`, no `app/api/cutout/**`, no job dir.
- **Register** in `packages/web/components/tools.ts`.

The multi-file "row per file" UX mirrors `HeicClient` / `ResizeClient`, but every
step runs client-side.

## Tool design: Remove a background (`cutout`, `/cutout`)

- **UI**: multi-file drop (`accept="image/*"`). Each file becomes a row:
  original thumbnail, status (`idle | preparing | busy | done | error`), and on
  completion a result preview shown on a **checkerboard backdrop** (so
  transparency reads clearly) plus a Download button.
- **Background fill option** (a `Segmented`): `Transparent | White | Custom
  colour`. Transparent → the raw cutout PNG (alpha preserved). White/Custom →
  composite the cutout over that solid colour on a `<canvas>` and export that
  PNG. Default transparent.
- **Run**: a "Remove backgrounds" button loops rows **serially** (not
  `Promise.all` — WASM inference is memory-heavy; one at a time avoids blowing
  up on a batch). For each row: `removeBackground(file, { publicPath: "/imgly/",
  progress })` → a `Blob` (PNG with alpha) → if a fill colour is set, composite
  on canvas → object URL → set the row `done` with its result URL + output name.
- **First-use model load**: the library's `progress` callback distinguishes
  "downloading/compiling the model" from "processing the image". The first run
  shows a one-time "Preparing the background remover…" state; later runs skip it
  (model cached). Surface progress on the active row.
- **Download**: `<a href={row.url} download={row.filename}>`; filename from
  `cutoutOutName(srcName)`. Object URLs are revoked on row removal and on unmount
  — using the `clipsRef`-style ref pattern from the splice tool (a `useEffect`
  cleanup keyed on `[]` that reads a ref synced to the live rows, NOT a stale
  initial closure — this exact bug was caught and fixed in splice).
- **SSR safety**: `CutoutClient` is `"use client"`, and the
  `import("@imgly/background-removal")` happens **inside the run handler**, never
  at module top level, so SSR/build never tries to instantiate WASM.
- **core/src/cutout.ts**:
  - `cutoutOutName(srcName)` → `<base>-cutout.png` (via `swapExt`).
  - `type BgFill = "transparent" | { color: string }`; `normalizeBgFill(raw:
    { mode?: string; color?: string })` → validates `#rrggbb`, returns
    `"transparent"` by default, `{ color }` for white/custom (white = `#ffffff`).
  - Both pure and unit-tested; that is the whole of the core module.

## Registry addition (`components/tools.ts`)

One new `Tool` entry:

| id | title | group | lucide icon | tags |
|----|-------|-------|-------------|------|
| `cutout` | Remove a background | images | `Eraser` | background, remove, cutout, transparent, png, photo |

`Eraser` verified to exist in `lucide-react` during implementation (swap if
missing). Group `images` already exists — no new group needed.

## Packaging

- **No native module** — nothing to unpack from asar, no ABI concern. This is
  the whole point of the client-side choice.
- The self-hosted model assets live under `packages/web/public/imgly/` and are
  included in the Next standalone `public/` output, so they ship in the packaged
  desktop app and work offline. Confirm the desktop `assemble-server` step copies
  `public/` into the bundle (it already must, for existing static assets) — note
  it as a verification point, not new work.

## Error handling

- A file that fails segmentation (corrupt image, unsupported content) sets that
  row to `error` with a readable message and a per-row retry; other rows are
  unaffected (serial loop continues).
- If model assets fail to load (missing `/imgly/` — a build-wiring failure), the
  first run surfaces a clear "Could not load the background remover" message
  rather than a raw stack.

## Testing

- **core** unit tests: `cutoutOutName` (extension swap, sanitisation),
  `normalizeBgFill` (transparent default, white → `#ffffff`, custom hex
  validation, junk → transparent).
- The segmentation library itself is not unit-tested (browser WASM). Build check:
  `next build` succeeds and `@imgly/background-removal` bundles into the client
  without pulling node-only built-ins (same check the QR tool needed).
- **Manual**: a real photo of a person → transparent PNG cutout that opens with
  the background gone; a second run reuses the model (no re-download); the White
  fill produces a white-background PNG; a batch of 3 processes one after another.

## Build / sequencing

Small — one tool, three tasks:

1. **Model-asset infra** — add `@imgly/background-removal` +
   `@imgly/background-removal-data` deps; `scripts/copy-bg-assets.mjs`; wire into
   `predev`/`prebuild`; git-ignore `public/imgly/`; verify assets land and
   `publicPath` resolves.
2. **The tool** — `core/src/cutout.ts` (TDD) + `app/cutout/{page,CutoutClient}` +
   the browser removal/preview/download flow with correct object-URL cleanup.
3. **Registry + smoke** — register `cutout` in `tools.ts`; `next build` lists
   `/cutout` and bundles the library; live smoke.

Subagent-driven, per-task reviewer gate, atomic commits, push to main.

## Open items for review

- **Engine choice** — confirm client-side WASM (default) vs the server-side
  native path. This is the big one; it reshapes the whole build.
- **License** — verify `@imgly/background-removal` / its model assets are
  licensed for this use before shipping. IMG.LY's terms should be checked during
  Task 1; if they require a commercial licence or attribution, surface it (this
  is a genuine unknown, not an assumed-fine).
- **Model asset hosting** — copy-from-npm-into-public (default) vs commit the
  ~40MB vs CDN-default (online-only). Default is the copy step.
- **Background fill** — ship the Transparent/White/Custom option in the MVP, or
  transparent-only and add fills later? Default: include the fill option (small).
- **Batch size guard** — cap the number of files per run (WASM memory), or leave
  unbounded with serial processing? Default: serial, no hard cap, with a note if
  a very large batch is slow.
