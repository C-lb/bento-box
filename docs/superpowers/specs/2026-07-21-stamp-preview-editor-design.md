# Confidentiality stamp preview editor

## Context

Third of four specs from one request (spec 1: rename + thumbnails, spec 2: HTML export — both shipped). This spec adds a live preview and editable controls (rotation, size, opacity) to the slicer's confidentiality watermark, which today is a fixed 45°/90%-diagonal/0.22-opacity grey stamp with no preview at all.

## Current state

- `packages/web/lib/pdf-slice.ts`'s `watermarkPdf(bytes, text)`: hardcodes `angle = Math.PI/4` (45°), `target = Math.hypot(width, height) * 0.9` (size), and `opacity: 0.22`. No parameters for any of these.
- `SliceClient.tsx`'s "3. Confidential watermark" card: just a checkbox and a watermark-text input. No preview, no way to see or adjust how the stamp looks before exporting.
- `buildOutputs(masterBytes, groups, opts)` opts today: `{ confidential: boolean; watermarkText: string; format?: "pdf" | "html" }`.
- `renderPdfPages(input: Buffer, scale?: number): Promise<Buffer[]>` (from spec 2, in `convert-file.ts`) already rasterizes PDF pages to PNG buffers — reusable here for the live preview image.
- `pageCount` is already known client-side in `SliceClient.tsx` (`setPageCount` from the initial deck upload/conversion step), before the user ever reaches the confidential-watermark card.

## Changes

### 1. `watermarkPdf` gains editable stamp parameters

In `packages/web/lib/pdf-slice.ts`:

```ts
export async function watermarkPdf(
  bytes: Uint8Array,
  text: string,
  opts?: { rotationDeg?: number; sizeScale?: number; opacity?: number },
): Promise<Uint8Array> {
  const rotationDeg = opts?.rotationDeg ?? 45;
  const sizeScale = opts?.sizeScale ?? 1;
  const opacity = opts?.opacity ?? 0.22;
  // ...same body, but: angle = (rotationDeg * Math.PI) / 180;
  // target = Math.hypot(width, height) * 0.9 * sizeScale;
  // page.drawText(..., rotate: degrees(rotationDeg), opacity)
}
```

Omitting `opts` (or any individual field) reproduces today's exact stamp — no behavior change for existing callers that don't pass it.

`buildOutputs`'s `opts` type gains the same three optional fields, passed straight through to its `watermarkPdf` call when `confidential: true`.

### 2. New live-preview route

`packages/web/app/api/slice/[runId]/stamp-preview/route.ts` (GET), query params: `page` (1-based int), `text`, `rotationDeg`, `sizeScale`, `opacity` (all optional except `page`, matching `watermarkPdf`'s defaults when absent).

Flow: load the master PDF for `runId`, validate `page` is within `1..pageCount` (400 if not), `extractPages(master, [page])` to get a single-page PDF, `watermarkPdf(that, text, { rotationDeg, sizeScale, opacity })`, then `renderPdfPages(Buffer.from(stampedBytes))` (reused from spec 2) and return `pages[0]` directly as a `Response` with `content-type: image/png` (no JSON wrapper — this is consumed as an `<img src>`).

Range validation happens server-side too (clamp `rotationDeg` to [-90, 90], `sizeScale` to [0.5, 1.5], `opacity` to [0.05, 0.6]) so a malformed query can't produce a broken or absurd stamp.

### 3. SliceClient UI

Inside "3. Confidential watermark", when the checkbox is checked, in addition to the existing watermark-text input:

- A page-number stepper (`min=1`, `max={pageCount}`, default `1`) — "Preview page".
- Three range sliders: Rotation (−90° to 90°, default 45), Size (50% to 150%, default 100%), Opacity (5% to 60%, default 22%).
- A live preview `<img>`, sized to fit the card, whose `src` is built from `runId` + the current page/text/rotation/size/opacity state. Slider/stepper/text changes update local state immediately (so the controls feel responsive) but the `<img src>` itself updates through a ~300ms debounce, so rapid dragging doesn't fire a request per pixel.
- While a preview request is in flight, keep showing the previous image (no flash-to-blank) with a subtle loading indicator; a preview fetch failure shows an inline error without blocking the rest of the form.

### 4. Export wiring

`exportPdfs()` includes `rotationDeg`, `sizeScale`, `opacity` in the POST body to `/api/slice/export` (only meaningful when `confidential: true`, but always sent for simplicity — `buildOutputs` only uses them inside the `if (opts.confidential)` branch anyway). The export route passes them through to `buildOutputs`. `reset()` resets all three back to their defaults (45 / 1.0 / 0.22).

Net effect: what's previewed is exactly what gets stamped into the exported PDF/HTML files, since both paths call the same `watermarkPdf` with the same parameters.

## Testing

- Unit: `watermarkPdf` with custom `rotationDeg`/`sizeScale`/`opacity` produces a valid PDF (page count unchanged) and that omitting `opts` reproduces the exact byte-for-byte-equivalent stamp behavior as before (same visual result at defaults).
- Unit: the preview route's range clamping (out-of-range query values get clamped, not rejected or passed through raw).
- Manual: with a real deck, open the confidential-watermark card, drag each slider, confirm the preview image updates after the debounce and visually reflects the change (steeper/shallower rotation, bigger/smaller text, lighter/darker stamp); export and confirm the downloaded file's stamp matches the last previewed settings.
