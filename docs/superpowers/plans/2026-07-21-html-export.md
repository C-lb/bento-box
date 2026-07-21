# HTML Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "export as HTML" output option to the convert tool (for `pdf`, `image`, `heic` categories) and the slicer tool (per-group HTML instead of PDF), by rasterizing PDF/image content to PNG and embedding it as base64 in a self-contained HTML document.

**Architecture:** Extract the existing pdfjs+canvas per-page rasterization logic (currently inlined in `pdfToImages`) into a reusable `renderPdfPages` helper. Add a new `pdf-to-html.ts` module that wraps raster PNG buffers into a standalone HTML document. Wire "html" into the existing `OutputFormat`/`OUTPUTS` data table so the convert tool's UI picks it up automatically, add a dispatch branch in `convertUploaded`, and add an equivalent `format` option to the slicer's `buildOutputs`.

**Tech Stack:** TypeScript, Next.js (App Router) API routes, `pdfjs-dist` + `@napi-rs/canvas` for PDF rasterization, `pdf-lib` for PDF manipulation, `sharp` for raster image conversion, Vitest for tests.

## Global Constraints

- HTML output is scoped to `pdf`, `image`, and `heic` convert categories only — never `audio`.
- Multi-page PDF → HTML is always a single combined file, never a zip (unlike the existing png/jpg path).
- The slicer's confidentiality watermark must already be baked into HTML output automatically (it's drawn onto the PDF before rasterization) — no separate stamping logic needed for the HTML path.
- No new npm dependencies — reuse `pdfjs-dist`, `@napi-rs/canvas`, `sharp`, `pdf-lib` already in `packages/web/package.json`.
- Follow existing test conventions: Vitest, `describe`/`it`/`expect`, tests live in `packages/web/test/*.test.ts` (web package) or alongside source as `*.test.ts` (core package).

---

### Task 1: Extract `renderPdfPages` from `pdfToImages`

**Files:**
- Modify: `packages/web/lib/convert-file.ts:43-79`
- Test: `packages/web/test/convert-file-pdf.test.ts`

**Interfaces:**
- Produces: `renderPdfPages(input: Buffer, scale?: number): Promise<Buffer[]>` — one PNG buffer per page, in page order. Exported from `@/lib/convert-file`. Later tasks (2, 4) import this.
- `pdfToImages(input: Buffer, output: "png" | "jpg"): Promise<{ data: Buffer; ext: string; zip: boolean }>` keeps its exact existing signature and behavior — this task must not change its observable output.

- [ ] **Step 1: Write the failing test for `renderPdfPages`**

Add to `packages/web/test/convert-file-pdf.test.ts` (after the existing imports, add `renderPdfPages` to the import from `@/lib/convert-file`):

```ts
import { pdfToImages, renderPdfPages } from "@/lib/convert-file";
```

Add a new describe block:

```ts
describe("renderPdfPages", () => {
  it("returns one PNG buffer per page, in order", async () => {
    const pages = await renderPdfPages(await makePdf(3));
    expect(pages.length).toBe(3);
    for (const p of pages) {
      expect(p.length).toBeGreaterThan(0);
      // PNG signature
      expect(p.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    }
  }, 30000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/web && npx vitest run test/convert-file-pdf.test.ts`
Expected: FAIL — `renderPdfPages` is not exported from `@/lib/convert-file`.

- [ ] **Step 3: Extract the helper**

Replace the body of `pdfToImages` in `packages/web/lib/convert-file.ts` (lines 43-79) with:

```ts
// Render every PDF page to a raster PNG at the given scale (default 2x).
export async function renderPdfPages(input: Buffer, scale = 2): Promise<Buffer[]> {
  // Legacy build runs under Node without a DOM. Import lazily so the module
  // only loads server-side when a PDF is actually converted.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(input),
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: true,
  }).promise;
  const pages: Buffer[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext("2d");
      // pdfjs expects a canvas 2d context; @napi-rs/canvas is compatible.
      await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise;
      pages.push(Buffer.from(await canvas.encode("png")));
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  if (pages.length === 0) throw new Error("The PDF has no pages.");
  return pages;
}

// Render every PDF page to a raster image. One page → the image;
// multiple → a zip of page-1.<ext>, page-2.<ext>, ...
export async function pdfToImages(
  input: Buffer, output: "png" | "jpg",
): Promise<{ data: Buffer; ext: string; zip: boolean }> {
  const pngPages = await renderPdfPages(input);
  const ext = output === "jpg" ? "jpg" : "png";
  const pages: { name: string; data: Buffer }[] = [];
  for (let i = 0; i < pngPages.length; i++) {
    const data = ext === "jpg"
      ? await sharp(pngPages[i]).jpeg({ quality: LOSSY_QUALITY }).toBuffer()
      : pngPages[i];
    pages.push({ name: `page-${i + 1}.${ext}`, data });
  }
  if (pages.length === 1) return { data: pages[0].data, ext, zip: false };
  return { data: await zipFiles(pages), ext: "zip", zip: true };
}
```

Note: this re-encodes jpg pages from the PNG buffer via `sharp` instead of `canvas.encode("jpeg", ...)` directly — this changes jpg byte output slightly but not observable behavior (still a valid JPEG). `sharp` is already imported at the top of this file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/web && npx vitest run test/convert-file-pdf.test.ts`
Expected: PASS — all 3 tests (`single page`, `multi page`, `renderPdfPages`) green.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/convert-file.ts packages/web/test/convert-file-pdf.test.ts
git commit -m "refactor: extract renderPdfPages helper from pdfToImages"
```

---

### Task 2: New `pdf-to-html.ts` module

**Files:**
- Create: `packages/web/lib/pdf-to-html.ts`
- Test: `packages/web/test/pdf-to-html.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (pure functions over Buffers).
- Produces: `pagesToHtml(pages: Buffer[], title?: string): Buffer` and `imageToHtml(imageBuffer: Buffer, mime: string, title?: string): Buffer`, both exported from `@/lib/pdf-to-html`. Tasks 4 and 5 import these.

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/pdf-to-html.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pagesToHtml, imageToHtml } from "@/lib/pdf-to-html";

function tinyPng(): Buffer {
  // 1x1 transparent PNG, valid minimal PNG bytes.
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
}

describe("pagesToHtml", () => {
  it("embeds one base64 image per page in a single HTML document", () => {
    const html = pagesToHtml([tinyPng(), tinyPng(), tinyPng()], "My Deck").toString("utf8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("My Deck");
    expect((html.match(/data:image\/png;base64,/g) ?? []).length).toBe(3);
  });

  it("throws on an empty page list", () => {
    expect(() => pagesToHtml([])).toThrow();
  });
});

describe("imageToHtml", () => {
  it("embeds a single image with the given mime type", () => {
    const html = imageToHtml(tinyPng(), "image/png", "My Photo").toString("utf8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("My Photo");
    expect((html.match(/data:image\/png;base64,/g) ?? []).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web && npx vitest run test/pdf-to-html.test.ts`
Expected: FAIL — cannot find module `@/lib/pdf-to-html`.

- [ ] **Step 3: Implement**

Create `packages/web/lib/pdf-to-html.ts`:

```ts
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function wrapDocument(title: string, body: string): Buffer {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 0; padding: 32px 16px; background: #f4f4f5; font-family: -apple-system, sans-serif; }
  .page { max-width: 960px; margin: 0 auto 24px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
  .page img { display: block; width: 100%; height: auto; }
  .page + .page { margin-top: 24px; }
</style>
</head>
<body>
${body}
</body>
</html>`;
  return Buffer.from(html, "utf8");
}

/** Wrap raster PNG page buffers into one self-contained HTML document. */
export function pagesToHtml(pages: Buffer[], title = "Document"): Buffer {
  if (pages.length === 0) throw new Error("No pages to export.");
  const body = pages
    .map((p) => `<div class="page"><img src="data:image/png;base64,${p.toString("base64")}" alt=""></div>`)
    .join("\n");
  return wrapDocument(title, body);
}

/** Wrap a single raster image buffer into a self-contained HTML document. */
export function imageToHtml(imageBuffer: Buffer, mime: string, title = "Image"): Buffer {
  const body = `<div class="page"><img src="data:${mime};base64,${imageBuffer.toString("base64")}" alt=""></div>`;
  return wrapDocument(title, body);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/web && npx vitest run test/pdf-to-html.test.ts`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/pdf-to-html.ts packages/web/test/pdf-to-html.test.ts
git commit -m "feat: add pdf-to-html module for HTML export"
```

---

### Task 3: Add "html" to convert-formats data table

**Files:**
- Modify: `packages/core/src/convert-formats.ts`
- Test: `packages/core/src/convert-formats.test.ts`

**Interfaces:**
- Produces: `OutputFormat` now includes `"html"`. `outputsFor("image")` includes `"html"`; `outputsFor("heic")` includes `"html"`; `outputsFor("pdf")` includes `"html"`; `outputsFor("audio")` unchanged. `extFor("html")` returns `"html"`. Tasks 4, 6 rely on these.

- [ ] **Step 1: Write the failing test**

Modify `packages/core/src/convert-formats.test.ts`'s `outputsFor` block:

```ts
describe("outputsFor", () => {
  it("lists outputs in display order, first is default", () => {
    expect(outputsFor("image")).toEqual(["png", "jpg", "webp", "pdf", "html"]);
    expect(outputsFor("heic")).toEqual(["png", "jpg", "pdf", "html"]);
    expect(outputsFor("pdf")).toEqual(["png", "jpg", "html"]);
    expect(outputsFor("audio")).toEqual(["mp3", "wav", "m4a"]);
  });
});
```

Add to the `extFor / isAudioOutput` block:

```ts
  it("maps outputs to extensions", () => {
    expect(extFor("jpg")).toBe("jpg");
    expect(extFor("png")).toBe("png");
    expect(extFor("pdf")).toBe("pdf");
    expect(extFor("m4a")).toBe("m4a");
    expect(extFor("html")).toBe("html");
  });
  it("flags audio outputs", () => {
    expect(isAudioOutput("mp3")).toBe(true);
    expect(isAudioOutput("wav")).toBe(true);
    expect(isAudioOutput("png")).toBe(false);
    expect(isAudioOutput("html")).toBe(false);
  });
```

Add to `isValidConversion`:

```ts
  it("accepts allowed pairs and rejects the rest", () => {
    expect(isValidConversion("a.png", "pdf")).toBe(true);
    expect(isValidConversion("a.pdf", "png")).toBe(true);
    expect(isValidConversion("a.mp4", "mp3")).toBe(true);
    expect(isValidConversion("a.mp4", "pdf")).toBe(false);
    expect(isValidConversion("a.png", "mp3")).toBe(false);
    expect(isValidConversion("a.xyz", "png")).toBe(false);
    expect(isValidConversion("a.pdf", "html")).toBe(true);
    expect(isValidConversion("a.mp4", "html")).toBe(false);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run src/convert-formats.test.ts`
Expected: FAIL — `outputsFor("image")` etc. don't include `"html"` yet; `extFor("html")` type error (not in `OutputFormat`).

- [ ] **Step 3: Implement**

In `packages/core/src/convert-formats.ts`:

```ts
export type OutputFormat = "png" | "jpg" | "webp" | "pdf" | "mp3" | "wav" | "m4a" | "html";
```

```ts
const OUTPUTS: Record<ConvertCategory, OutputFormat[]> = {
  image: ["png", "jpg", "webp", "pdf", "html"],
  heic: ["png", "jpg", "pdf", "html"],
  pdf: ["png", "jpg", "html"],
  audio: ["mp3", "wav", "m4a"],
};
```

`extFor` needs no change — it already returns `output` verbatim, and `"html"` equals its own extension.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run src/convert-formats.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/convert-formats.ts packages/core/src/convert-formats.test.ts
git commit -m "feat: add html output format to convert-formats"
```

---

### Task 4: Wire HTML into `convertUploaded` dispatch + download route

**Files:**
- Modify: `packages/web/lib/convert-file.ts`
- Modify: `packages/web/app/api/convert/[id]/route.ts`
- Test: `packages/web/test/convert-dispatch.test.ts`

**Interfaces:**
- Consumes: `renderPdfPages` (Task 1), `pagesToHtml`/`imageToHtml` (Task 2), `OutputFormat` including `"html"` (Task 3).
- Produces: `convertUploaded(inPath, inputName, id, "html")` writes `out.html` for `pdf`/`image`/`heic` categories and returns `{ ext: "html", zip: false }`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/web/test/convert-dispatch.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
```
(already imported — reuse existing imports; only add new `it` blocks below inside the existing `describe("convertUploaded (image branch)")`, plus a new describe for pdf.)

```ts
  it("routes png→html and writes a self-contained HTML file", async () => {
    const png = await sharp({ create: { width: 3, height: 3, channels: 3, background: "#123456" } }).png().toBuffer();
    const id = "testjob3";
    const dir = convertDir(id);
    require("node:fs").mkdirSync(dir, { recursive: true });
    const inPath = resolve(dir, "source");
    writeFileSync(inPath, png);
    const res = await convertUploaded(inPath, "pic.png", id, "html");
    expect(res).toEqual({ ext: "html", zip: false });
    const html = readFileSync(resolve(dir, "out.html"), "utf8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("data:image/png;base64,");
  });
```

Add a new describe block at the end of the file for the PDF branch:

```ts
describe("convertUploaded (pdf branch)", () => {
  it("routes pdf→html and writes a single combined HTML file (no zip)", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    doc.addPage([100, 100]);
    const pdfBytes = Buffer.from(await doc.save());
    const id = "testjob4";
    const dir = convertDir(id);
    require("node:fs").mkdirSync(dir, { recursive: true });
    const inPath = resolve(dir, "source");
    writeFileSync(inPath, pdfBytes);
    const res = await convertUploaded(inPath, "deck.pdf", id, "html");
    expect(res).toEqual({ ext: "html", zip: false });
    const html = readFileSync(resolve(dir, "out.html"), "utf8");
    expect((html.match(/data:image\/png;base64,/g) ?? []).length).toBe(2);
  }, 30000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/web && npx vitest run test/convert-dispatch.test.ts`
Expected: FAIL — `convertUploaded(..., "html")` throws `Cannot convert this file to html.`

- [ ] **Step 3: Implement**

In `packages/web/lib/convert-file.ts`, add one new import line near the top (alongside the other `@/lib/*` imports) — `renderPdfPages` needs no import since it's already defined in this same file from Task 1:

```ts
import { pagesToHtml, imageToHtml } from "@/lib/pdf-to-html";
```

Modify `convertUploaded`'s `pdf` branch:

```ts
  if (category === "pdf") {
    if (output === "html") {
      const pages = await renderPdfPages(input);
      const html = pagesToHtml(pages, inputName);
      await writeFile(resolve(dir, "out.html"), html);
      return { ext: "html", zip: false };
    }
    if (output !== "png" && output !== "jpg") throw new Error(`Cannot convert a PDF to ${output}.`);
    const { data, ext, zip } = await pdfToImages(input, output);
    await writeFile(resolve(dir, `out.${ext}`), data);
    return { ext, zip };
  }
```

Modify the `image`/`heic` branch to add an `html` case before the existing `pdf`/format checks:

```ts
  if (category === "image" || category === "heic") {
    if (output === "html") {
      const png = category === "heic" ? await heicToRaster(input, "png") : await imageToRaster(input, "png");
      const html = imageToHtml(png, "image/png", inputName);
      await writeFile(resolve(dir, "out.html"), html);
      return { ext: "html", zip: false };
    }
    if (output === "pdf") {
      const png = category === "heic" ? await heicToRaster(input, "png") : input;
      const data = await imageToPdf(png);
      await writeFile(resolve(dir, "out.pdf"), data);
      return { ext: "pdf", zip: false };
    }
    if (category === "heic") {
      if (output !== "png" && output !== "jpg") throw new Error(`Cannot convert this file to ${output}.`);
      const data = await heicToRaster(input, output);
      await writeFile(resolve(dir, `out.${extFor(output)}`), data);
      return { ext: extFor(output), zip: false };
    }
    if (output === "png" || output === "jpg" || output === "webp") {
      const data = await imageToRaster(input, output);
      await writeFile(resolve(dir, `out.${extFor(output)}`), data);
      return { ext: extFor(output), zip: false };
    }
  }
```

Note: for the plain `image` category, `imageToRaster(input, "png")` is used instead of passing `input` straight through, since `input` might already be jpg/webp — normalizing to PNG first keeps `imageToHtml`'s `image/png` mime accurate.

In `packages/web/app/api/convert/[id]/route.ts`, add to `CONTENT_TYPES`:

```ts
const CONTENT_TYPES: Record<string, string> = {
  zip: "application/zip",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  html: "text/html",
};
```

And change the default fallback so an html request doesn't silently fall back to mp3 — check the `ext` query param default logic: it currently defaults to `"mp3"` when missing/invalid, which is fine (existing behavior, unrelated to this change; the frontend always passes a valid `ext`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/web && npx vitest run test/convert-dispatch.test.ts`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/convert-file.ts packages/web/app/api/convert/[id]/route.ts packages/web/test/convert-dispatch.test.ts
git commit -m "feat: wire html output into convertUploaded dispatch"
```

---

### Task 5: Add `format` option to slicer's `buildOutputs`

**Files:**
- Modify: `packages/web/lib/pdf-slice.ts`
- Test: `packages/web/test/pdf-slice.test.ts`

**Interfaces:**
- Consumes: `renderPdfPages` and `pagesToHtml` — but `pdf-slice.ts` works with `Uint8Array` (pdf-lib convention) while `renderPdfPages`/`pagesToHtml` work with `Buffer`. `Buffer` is a subclass of `Uint8Array` in Node, so passing a `Uint8Array` from pdf-lib's `.save()` into `renderPdfPages(input: Buffer, ...)` requires wrapping with `Buffer.from(bytes)` — do this at the call site.
- Produces: `buildOutputs(masterBytes, groups, opts)` where `opts` now accepts `format?: "pdf" | "html"` (default `"pdf"`). When `"html"`, each `OutputFile.filename` has the `.pdf` extension swapped to `.html` via `swapExt` from `@event-editor/core/names`.

- [ ] **Step 1: Write the failing test**

Add to `packages/web/test/pdf-slice.test.ts`:

```ts
  it("builds HTML output per group when format is html", async () => {
    const master = await makePdf(4);
    const groups = [{ label: "Intro", filename: "Intro.pdf", pages: [1, 2] }];
    const out = await buildOutputs(master, groups, { confidential: false, watermarkText: "CONFIDENTIAL", format: "html" });
    expect(out[0].filename).toBe("Intro.html");
    const html = Buffer.from(out[0].bytes).toString("utf8");
    expect(html).toContain("<!DOCTYPE html>");
    expect((html.match(/data:image\/png;base64,/g) ?? []).length).toBe(2);
  }, 30000);

  it("defaults to pdf format when format is omitted", async () => {
    const master = await makePdf(2);
    const groups = [{ label: "Intro", filename: "Intro.pdf", pages: [1] }];
    const out = await buildOutputs(master, groups, { confidential: false, watermarkText: "CONFIDENTIAL" });
    expect(out[0].filename).toBe("Intro.pdf");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web && npx vitest run test/pdf-slice.test.ts`
Expected: FAIL — `format` option is ignored, `out[0].filename` is still `"Intro.pdf"` in the html test (TypeScript may also flag `format` as excess property depending on tsconfig strictness — either way, the assertion fails at runtime).

- [ ] **Step 3: Implement**

In `packages/web/lib/pdf-slice.ts`, add imports and modify `buildOutputs`:

```ts
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import type { PlannedGroup } from "@event-editor/core/slice-plan";
import { swapExt } from "@event-editor/core/names";
import { renderPdfPages } from "@/lib/convert-file";
import { pagesToHtml } from "@/lib/pdf-to-html";
```

```ts
/** Build one PDF (or HTML) per planned group, watermarking when confidential. */
export async function buildOutputs(
  masterBytes: Uint8Array,
  groups: PlannedGroup[],
  opts: { confidential: boolean; watermarkText: string; format?: "pdf" | "html" },
): Promise<OutputFile[]> {
  const format = opts.format ?? "pdf";
  const out: OutputFile[] = [];
  for (const g of groups) {
    let bytes = await extractPages(masterBytes, g.pages);
    if (opts.confidential) bytes = await watermarkPdf(bytes, opts.watermarkText);
    if (format === "html") {
      const pages = await renderPdfPages(Buffer.from(bytes));
      const html = pagesToHtml(pages, g.label);
      out.push({ label: g.label, filename: swapExt(g.filename, "html"), bytes: html });
      continue;
    }
    out.push({ label: g.label, filename: g.filename, bytes });
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/web && npx vitest run test/pdf-slice.test.ts`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/pdf-slice.ts packages/web/test/pdf-slice.test.ts
git commit -m "feat: add html format option to slicer buildOutputs"
```

---

### Task 6: Slicer UI toggle + export route + download route content-type

**Files:**
- Modify: `packages/web/app/slice/SliceClient.tsx`
- Modify: `packages/web/app/api/slice/export/route.ts`
- Modify: `packages/web/app/api/slice/[runId]/file/[name]/route.ts`
- Test: manual (Playwright/dev-server visual check — no existing automated UI test harness for this component's export button; covered by Task 5's unit tests for the underlying `buildOutputs` logic)

**Interfaces:**
- Consumes: `buildOutputs`'s `format` option (Task 5).
- Produces: no new exports — this is the UI/route wiring layer.

- [ ] **Step 1: Add the format toggle state and Segmented control to `SliceClient.tsx`**

Add the import (alongside other component imports near the top of the file):

```tsx
import { Segmented } from "@/components/Segmented";
```

Add state near the existing `confidential`/`watermark` state (around line 32):

```tsx
const [format, setFormat] = useState<"pdf" | "html">("pdf");
```

In `exportPdfs()` (line 97), include `format` in the request body:

```tsx
        body: JSON.stringify({ runId, groups: rows, confidential, watermarkText: watermark, format }),
```

In `reset()` (line 186), reset the new state:

```tsx
    setMode("manual"); setConfidential(false); setWatermark("CONFIDENTIAL"); setDriveFolder(""); setFormat("pdf");
```

In the "4. Export" card (around line 326-337), add the toggle above the button row and change the button label:

```tsx
          {/* Export */}
          <div className="card">
            <p className="eyebrow">4. Export</p>
            <div className="mt-3">
              <Segmented
                options={[{ value: "pdf", label: "PDF" }, { value: "html", label: "HTML" }]}
                value={format}
                onChange={(v) => setFormat(v as "pdf" | "html")}
              />
            </div>
            <div className="mt-3 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
              <button
                type="button"
                className="btn btn-accent min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center"
                onClick={exportPdfs}
                disabled={busy}
              >
                {status === "exporting" ? "Building…" : format === "html" ? "Build HTML pages" : "Build PDFs"}
              </button>
              <button
                type="button"
                className="btn min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center"
                onClick={reset}
                disabled={busy}
              >
                Start over
```

(Everything after "Start over" is unchanged — only the button label and the new Segmented block above it are added.)

- [ ] **Step 2: Pass `format` through the export API route**

In `packages/web/app/api/slice/export/route.ts`, update the request body type and pass `format` through:

```ts
    const { runId, groups, confidential, watermarkText, format } = (await request.json()) as {
      runId: string;
      groups: GroupInput[];
      confidential: boolean;
      watermarkText?: string;
      format?: "pdf" | "html";
    };
```

```ts
    const outputs = await buildOutputs(master, plan.groups, {
      confidential: !!confidential,
      watermarkText: watermarkText ?? "CONFIDENTIAL",
      format: format === "html" ? "html" : "pdf",
    });
```

- [ ] **Step 3: Fix the hardcoded content-type in the per-file download route**

In `packages/web/app/api/slice/[runId]/file/[name]/route.ts`, replace the hardcoded `"application/pdf"` with an extension-based lookup:

```ts
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import { outDir } from "@/lib/slice";

export const runtime = "nodejs";

const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".html": "text/html",
};

export async function GET(_req: Request, ctx: { params: Promise<{ runId: string; name: string }> }) {
  const { runId, name } = await ctx.params;
  const safe = basename(name); // block path traversal
  try {
    const bytes = await readFile(join(outDir(runId), safe));
    const contentType = CONTENT_TYPES[extname(safe).toLowerCase()] ?? "application/octet-stream";
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": contentType,
        "content-disposition": `attachment; filename="${safe.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
```

- [ ] **Step 4: Typecheck and build**

Run: `cd packages/web && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "SliceClient\|slice/export\|slice/\[runId\]/file"`
Expected: no output (no new type errors introduced by this task's files).

- [ ] **Step 5: Manual verification with the dev server**

Run: `cd packages/web && npm run dev` (background), then in a browser:
1. Navigate to `/slice`, upload a small multi-page PDF, plan 2 portions.
2. Toggle the new PDF/HTML segmented control to HTML — confirm the export button now reads "Build HTML pages".
3. Enable the confidentiality checkbox with default text, click "Build HTML pages".
4. Download one of the resulting `.html` files, open it in a browser tab — confirm it renders the correct pages as images with the "CONFIDENTIAL" watermark visible, and the browser's network tab shows `content-type: text/html` for the download.
5. Toggle back to PDF, re-export, confirm the existing PDF path (unchanged) still works and downloads with `content-type: application/pdf`.

Kill the dev server after verification: `pkill -f "next dev --port 3000"`.

- [ ] **Step 6: Commit**

```bash
git add packages/web/app/slice/SliceClient.tsx packages/web/app/api/slice/export/route.ts packages/web/app/api/slice/[runId]/file/[name]/route.ts
git commit -m "feat: add HTML export toggle to slicer UI"
```

---

## Verification (full suite)

- [ ] Run the full web test suite: `cd packages/web && npx vitest run` — expect all tests green (pre-existing `.next`/test-type-error noise from `tsc --noEmit` is unrelated and out of scope, per spec 1's precedent).
- [ ] Run the core package test suite: `cd packages/core && npx vitest run` — expect all tests green.
- [ ] Grep for stray references to the old `pdfToImages` inline rendering logic to confirm nothing else duplicated it: `grep -rn "pdfjs-dist/legacy" packages/web/lib packages/web/app --include="*.ts" --include="*.tsx"` — should show exactly one hit, inside `renderPdfPages` in `convert-file.ts`.
