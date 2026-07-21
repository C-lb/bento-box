# HTML export for slicer and convert tools

## Context

Second of four specs from one request (spec 1, rename + thumbnail fix, shipped `d5137b4`). This spec adds an "export as HTML" option to two tools: the slicer (deck → per-section files) and the convert tool (format conversion) — scoped to `pdf`/`image`/`heic` categories, not audio. The other two specs (stamp preview editor, Workflow tab) follow separately.

## Current state

- **Slicer** (`packages/web/lib/pdf-slice.ts`): `buildOutputs()` always produces one PDF per group (manual page range / AI speaker segment / topic segment), optionally watermarked with a confidentiality stamp. No non-PDF output path exists.
- **Convert** (`packages/core/src/convert-formats.ts`, `packages/web/lib/convert-file.ts`): centralized `OUTPUTS` table drives a `<Segmented>` button UI per input category. `image`→`png/jpg/webp/pdf`, `heic/heif`→`png/jpg/pdf`, `pdf`→`png/jpg` (multi-page zips), `audio`→`mp3/wav/m4a`. Dispatch happens in one `convertUploaded()` function, switching on category then output.
- PDF page rasterization already exists in `convert-file.ts`'s `pdfToImages`, using `pdfjs-dist` + `@napi-rs/canvas` (`page.getViewport({scale:2})` → canvas render → `canvas.encode("png"/"jpeg")`), but it's inlined and only returns a single combined Buffer/zip, not a reusable per-page array.
- No existing utility in the repo assembles raster images into a standalone HTML document.

## Changes

### 1. Shared rasterization + HTML assembly (`packages/web/lib`)

- Refactor `pdfToImages` in `convert-file.ts` to extract its per-page pdfjs+canvas render loop into `renderPdfPages(input: Buffer, scale?: number): Promise<Buffer[]>` — returns one PNG buffer per page. `pdfToImages` becomes a thin wrapper: call `renderPdfPages`, then keep its existing single-buffer / zip-multi-page behavior unchanged.
- New file `packages/web/lib/pdf-to-html.ts`:
  - `pagesToHtml(pages: Buffer[], title?: string): Buffer` — builds one self-contained `<!DOCTYPE html>` document, each page's PNG embedded as a base64 `data:image/png;base64,...` `<img>`, pages stacked vertically with a light divider, centered, max-width container. No external file references, no zip — always a single HTML file regardless of page count.
  - `imageToHtml(imageBuffer: Buffer, mime: string, title?: string): Buffer` — same wrapper markup, single embedded image, for the image/heic single-image case.

### 2. Convert tool

- `packages/core/src/convert-formats.ts`: add `"html"` to `OutputFormat`; add `"html"` to the `OUTPUTS` arrays for `image`, `heic`/`heif`, and `pdf` categories only (not `audio`). Add `extFor`/mime handling for `html` → `.html` / `text/html`.
- `convert-file.ts` `convertUploaded()`: new `output === "html"` branch —
  - `pdf` category: `renderPdfPages(input)` → `pagesToHtml(pages)` → always a single file, never zipped (differs from the existing png/jpg path, which zips multi-page output).
  - `image`/`heic` category: convert to PNG via the existing sharp path, then `imageToHtml(pngBuffer, "image/png")`.
- No UI changes needed — the `<Segmented>` control in `ConvertClient.tsx` is driven entirely by the `OUTPUTS` table, so an "HTML" button appears automatically wherever it's now listed.

### 3. Slicer tool

- `pdf-slice.ts` `buildOutputs(masterBytes, groups, opts)`: `opts` gains `format?: "pdf" | "html"` (default `"pdf"`). Per group, after `extractPages` + optional `watermarkPdf` produce the group's PDF bytes exactly as today, if `format === "html"` pipe those bytes through `renderPdfPages` + `pagesToHtml` before constructing the `OutputFile` — same `label`/filename base, `.html` extension and `text/html` instead of `.pdf`/`application/pdf`. The confidentiality stamp requires no extra work: it's drawn onto the PDF pages before rasterization, so it's baked into the HTML's embedded images automatically.
- `SliceClient.tsx`: add a small PDF/HTML `<Segmented>` toggle next to the existing "Build PDFs" button in the "4. Export" card (mirrors the convert tool's own format control). Button label switches to "Build HTML pages" when HTML is selected.
- `app/api/slice/export/route.ts`: accept a `format` field in the request body (default `"pdf"`), pass through to `buildOutputs`.

## Testing

- Convert tool: upload a multi-page PDF, select HTML output, confirm a single downloadable `.html` file opens in a browser showing all pages in order, no zip. Upload a PNG/HEIC, select HTML, confirm a single-image HTML file downloads correctly.
- Slicer: run an export with the HTML toggle on, confirm one `.html` file per group downloads and opens correctly, and that a group exported with the confidentiality stamp enabled shows the watermark baked into the page images.
- Confirm existing PDF/PNG/JPG export paths for both tools are unchanged (regression check on `pdfToImages` after the `renderPdfPages` extraction).
